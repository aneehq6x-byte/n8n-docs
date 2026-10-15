"""Options contract selection for a directional setup.

A contract is picked only if, after the live spread, estimated slippage,
fees, theta decay to the expected holding time and an IV-crush haircut, the
*option's* expected move to target still pays at least ``min_reward_risk`` vs
its stop. Direction alone is never enough.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from umip.market_data.base import OptionChain, OptionQuote
from umip.options.pricing import bs_price
from umip.timeutil import NY, ensure_utc, minutes_to_close


@dataclass(frozen=True)
class OptionsPolicy:
    min_open_interest: int = 500
    min_volume: int = 100
    max_spread_pct: float = 0.10  # of mid
    max_spread_abs_0dte: float = 0.30
    delta_band: tuple[float, float] = (0.30, 0.60)
    min_reward_risk: float = 1.5
    fee_per_contract: float = 0.65
    slippage_fraction_of_spread: float = 0.5  # pay half the spread beyond mid
    iv_crush_vol_points: float = 0.0  # set >0 around events (e.g. 0.05 = 5 vol pts)
    allow_0dte: bool = True
    zero_dte_no_entry_last_minutes: int = 60
    zero_dte_no_entry_first_minutes: int = 15
    max_dte: int = 45
    risk_free_rate: float = 0.04


@dataclass(frozen=True)
class UnderlyingPlan:
    symbol: str
    direction: str  # long | short
    spot: float
    target1: float
    target2: float
    stop: float
    expected_hold_minutes: int


@dataclass
class ContractEval:
    quote: OptionQuote
    accepted: bool
    reasons: list[str] = field(default_factory=list)
    entry_price: float = 0.0  # mid + slippage, per share
    value_at_t1: float = 0.0
    value_at_stop: float = 0.0
    reward_risk: float = 0.0
    max_loss_per_contract: float = 0.0
    breakeven_at_expiry: float = 0.0
    score: float = 0.0

    def summary(self) -> dict:
        q = self.quote
        return {"contract": q.contract, "right": q.right, "strike": q.strike,
                "expiry": q.expiry.isoformat(), "bid": q.bid, "ask": q.ask,
                "entry_est": round(self.entry_price, 2), "value_at_t1": round(self.value_at_t1, 2),
                "value_at_stop": round(self.value_at_stop, 2),
                "reward_risk": round(self.reward_risk, 2),
                "max_loss_per_contract": round(self.max_loss_per_contract, 2),
                "breakeven": round(self.breakeven_at_expiry, 2), "iv": q.iv, "delta": q.delta,
                "oi": q.open_interest, "volume": q.volume, "source": q.source,
                "as_of": q.as_of.isoformat(), "reasons": self.reasons}


def _years(now: datetime, expiry_close: datetime) -> float:
    return max((expiry_close - now).total_seconds(), 60) / (365 * 24 * 3600)


def evaluate_contract(q: OptionQuote, plan: UnderlyingPlan, now: datetime,
                      policy: OptionsPolicy) -> ContractEval:
    ev = ContractEval(q, False)
    want = "C" if plan.direction == "long" else "P"
    if q.right != want:
        ev.reasons.append("wrong right for direction")
        return ev
    now = ensure_utc(now)
    dte = (q.expiry - now.astimezone(NY).date()).days
    is_0dte = dte == 0
    if dte < 0 or dte > policy.max_dte:
        ev.reasons.append(f"dte {dte} out of range")
    if is_0dte:
        if not policy.allow_0dte:
            ev.reasons.append("0DTE disabled")
        mtc = minutes_to_close(now)
        if mtc < policy.zero_dte_no_entry_last_minutes:
            ev.reasons.append(f"0DTE: {mtc:.0f} min to close")
        if q.spread > policy.max_spread_abs_0dte:
            ev.reasons.append("0DTE spread too wide")
    if q.bid <= 0 or q.ask <= 0:
        ev.reasons.append("no two-sided market")
        return ev
    if q.open_interest < policy.min_open_interest:
        ev.reasons.append(f"OI {q.open_interest} < {policy.min_open_interest}")
    if q.volume < policy.min_volume:
        ev.reasons.append(f"volume {q.volume} < {policy.min_volume}")
    if q.spread_pct > policy.max_spread_pct:
        ev.reasons.append(f"spread {q.spread_pct:.1%} > {policy.max_spread_pct:.0%}")
    if q.delta is None or q.iv is None:
        ev.reasons.append("missing greeks/iv")
        return ev
    lo, hi = policy.delta_band
    if not lo <= abs(q.delta) <= hi:
        ev.reasons.append(f"|delta| {abs(q.delta):.2f} outside {lo}-{hi}")

    expiry_close = datetime.combine(q.expiry, datetime.min.time(), tzinfo=NY) + timedelta(hours=16)
    t_now = _years(now, expiry_close)
    t_exit = _years(now + timedelta(minutes=plan.expected_hold_minutes), expiry_close)
    exit_iv = max(q.iv - policy.iv_crush_vol_points, 0.01)
    r = policy.risk_free_rate
    # Model-implied mid now vs. market mid: re-anchor model to market to avoid bias.
    model_now = bs_price(plan.spot, q.strike, t_now, r, q.iv, q.right)
    anchor = q.mid - model_now
    slip = q.spread * policy.slippage_fraction_of_spread
    fee = policy.fee_per_contract / 100  # per share
    ev.entry_price = q.mid + slip + fee
    # Exit at bid-ish: subtract half the spread again plus fee.
    exit_cost = slip + fee
    ev.value_at_t1 = max(bs_price(plan.target1, q.strike, t_exit, r, exit_iv, q.right) + anchor
                         - exit_cost, 0.0)
    ev.value_at_stop = max(bs_price(plan.stop, q.strike, t_exit, r, exit_iv, q.right) + anchor
                           - exit_cost, 0.0)
    reward = ev.value_at_t1 - ev.entry_price
    risk = ev.entry_price - ev.value_at_stop
    ev.reward_risk = reward / risk if risk > 0 else 0.0
    ev.max_loss_per_contract = ev.entry_price * 100
    ev.breakeven_at_expiry = q.strike + ev.entry_price if q.right == "C" else q.strike - ev.entry_price
    if reward <= 0:
        ev.reasons.append("option does not gain at T1 after costs/theta/IV")
    elif ev.reward_risk < policy.min_reward_risk:
        ev.reasons.append(f"option R:R {ev.reward_risk:.2f} < {policy.min_reward_risk}")
    ev.accepted = not ev.reasons
    if ev.accepted:
        liq = min(q.open_interest / 5000, 1.0) * 0.5 + min(q.volume / 2000, 1.0) * 0.5
        ev.score = ev.reward_risk * (1 - q.spread_pct) * (0.5 + 0.5 * liq)
    return ev


def select_contract(chain: OptionChain, plan: UnderlyingPlan, now: datetime,
                    policy: OptionsPolicy = OptionsPolicy()) -> tuple[ContractEval | None, list[ContractEval]]:
    """Best accepted contract (or None) and all evaluations for audit."""
    evals = [evaluate_contract(q, plan, now, policy) for q in chain.quotes]
    accepted = sorted((e for e in evals if e.accepted), key=lambda e: e.score, reverse=True)
    return (accepted[0] if accepted else None), evals

