"""Signal pipeline: data → strategy → (options) → risk → stored candidate.

The quant decision is fully deterministic. Any AI explanation is attached
later and never changes the numbers.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from umip.config import PublishMode
from umip.flags import DISABLED_STRATEGIES, get_flag, kill_switch_on
from umip.market_data.base import (
    DataUnavailableError, Freshness, MarketDataProvider, StaleDataError,
)
from umip.market_data.health import FeedHealth
from umip.models import ResultKind, Signal, SignalStatus
from umip.options.selector import OptionsPolicy, UnderlyingPlan, select_contract
from umip.quant.strategies import Strategy
from umip.risk.engine import OpenSignal, RiskContext, RiskPolicy, SignalProposal, evaluate
from umip.signals import service as sigsvc
from umip.timeutil import NY, ensure_utc, utcnow


@dataclass
class PipelineResult:
    symbol: str
    strategy: str
    outcome: str  # no_setup | data_blocked | rejected | validated | approved
    signal_ref: str | None = None
    reasons: list[str] | None = None


async def _open_signals(session: AsyncSession) -> list[OpenSignal]:
    q = select(Signal).where(Signal.status.in_(sigsvc.OPEN_STATES))
    return [OpenSignal(s.ref, s.symbol, s.direction,
                       bool(s.original.get("option") and s.original["option"]["expiry"]
                            == ensure_utc(s.detected_at).astimezone(NY).date().isoformat()))
            for s in (await session.scalars(q)).all()]


async def run_once(session: AsyncSession, provider: MarketDataProvider, strategy: Strategy,
                   symbol: str, *, policy: RiskPolicy, options_policy: OptionsPolicy | None,
                   health: FeedHealth, max_quote_age: timedelta, publish_mode: PublishMode,
                   now: datetime | None = None, allow_mock: bool = False,
                   kind: ResultKind = ResultKind.PUBLISHED,
                   recent_r: list[float] | None = None,
                   max_price_drift: float = 0.002) -> PipelineResult:
    now = now or utcnow()
    fresh = Freshness(max_quote_age, now_fn=lambda: now)
    try:
        quote = await provider.quote(symbol)
        fresh.check(quote.as_of, f"{symbol} quote")
        bars = await provider.bars(symbol, strategy.timeframe, now - timedelta(days=5), now)
        bars = [b for b in bars if b.ts + timedelta(minutes=5) <= now]  # closed bars only
        health.ok(provider.name, now)
    except (StaleDataError, DataUnavailableError) as e:
        health.fail(provider.name)
        return PipelineResult(symbol, strategy.name, "data_blocked", reasons=[str(e)])

    cand = strategy.evaluate(symbol, bars)
    if cand is None:
        return PipelineResult(symbol, strategy.name, "no_setup")
    # The setup was computed on closed bars; refuse it if the live price has
    # already moved away (or the feeds disagree).
    drift = abs(quote.last - cand.reference_price) / cand.reference_price
    if drift > max_price_drift:
        return PipelineResult(symbol, strategy.name, "rejected",
                              reasons=[f"live price {quote.last:.2f} drifted {drift:.2%} from "
                                       f"setup reference {cand.reference_price:.2f}"])

    option_eval = None
    option_spread_ok = True
    if options_policy is not None:
        try:
            chain = await provider.option_chain(symbol)
            Freshness(max_quote_age * 4, now_fn=lambda: now).check(chain.as_of, "option chain")
        except (StaleDataError, DataUnavailableError) as e:
            return PipelineResult(symbol, strategy.name, "data_blocked", reasons=[str(e)])
        plan = UnderlyingPlan(symbol, cand.direction, quote.last, cand.target1, cand.target2,
                              cand.stop, cand.expected_hold_minutes)
        option_eval, _ = select_contract(chain, plan, now, options_policy)
        if option_eval is None:
            return PipelineResult(symbol, strategy.name, "rejected",
                                  reasons=["no option contract passes liquidity/edge filters"])

    spread_bps = None
    if quote.bid and quote.ask:
        spread_bps = (quote.ask - quote.bid) / quote.mid * 1e4
    is_0dte = bool(option_eval and option_eval.quote.expiry == now.astimezone(NY).date())
    disabled = frozenset(await get_flag(session, DISABLED_STRATEGIES, []) or [])
    ctx = RiskContext(now=now, open_signals=await _open_signals(session),
                      recent_r=recent_r or [], kill_switch=await kill_switch_on(session),
                      data_healthy=health.is_healthy(provider.name, now),
                      data_is_mock=provider.is_mock, allow_mock=allow_mock,
                      underlying_spread_bps=spread_bps, disabled_strategies=disabled)
    proposal = SignalProposal(cand.strategy, symbol, cand.direction, cand.score, cand.reward_risk,
                              is_option=option_eval is not None, is_0dte=is_0dte,
                              option_spread_ok=option_spread_ok)
    decision = evaluate(proposal, ctx, policy)

    sig = await sigsvc.create_candidate(session, cand, quote.source, quote.as_of,
                                        provider.is_mock, option_eval, kind)
    await sigsvc.validate(session, sig, decision, now)
    if sig.status == SignalStatus.REJECTED:
        return PipelineResult(symbol, strategy.name, "rejected", sig.ref, decision.violations)
    if publish_mode == PublishMode.AUTOMATIC:
        await sigsvc.approve(session, sig, "auto", publish_mode)
        return PipelineResult(symbol, strategy.name, "approved", sig.ref)
    return PipelineResult(symbol, strategy.name, "validated", sig.ref)  # awaits human review
