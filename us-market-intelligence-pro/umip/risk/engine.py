"""Risk Policy Engine — independent of the bot/UI. Has veto power.

``evaluate`` returns a decision with every failed rule listed; a signal is
approved only when the list is empty. All limits are configurable with
conservative defaults.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from umip.instruments import get_spec
from umip.market_data.base import EconomicEvent
from umip.timeutil import ensure_utc, is_regular_session, minutes_since_open, minutes_to_close


@dataclass(frozen=True)
class RiskPolicy:
    max_risk_per_trade_pct: float = 0.5  # of the model (paper) account
    max_open_signals: int = 3
    max_open_per_correlation_group: int = 1
    daily_loss_limit_r: float = 3.0  # paper-evaluation daily stop
    min_reward_risk: float = 1.5
    min_score: float = 60.0
    max_underlying_spread_bps: float = 5.0
    event_blackout_before: timedelta = timedelta(minutes=30)
    event_blackout_after: timedelta = timedelta(minutes=30)
    high_impact_events: tuple[str, ...] = ("CPI", "PCE", "NFP", "FOMC", "GDP", "PPI")
    no_entry_first_minutes: int = 5
    no_entry_last_minutes: int = 30
    zero_dte_enabled: bool = False  # off by default at launch
    zero_dte_max_open: int = 1
    circuit_breaker_consecutive_losses: int = 4
    circuit_breaker_rolling_n: int = 20
    circuit_breaker_min_expectancy_r: float = -0.1
    allow_naked_short_options: bool = False  # never proposed by default
    enabled_strategies: frozenset[str] = frozenset()  # nothing auto-enabled before validation


@dataclass
class OpenSignal:
    ref: str
    symbol: str
    direction: str
    is_0dte: bool


@dataclass
class RiskContext:
    now: datetime
    open_signals: list[OpenSignal] = field(default_factory=list)
    realized_r_today: float = 0.0
    recent_r: list[float] = field(default_factory=list)  # most recent last
    kill_switch: bool = False
    data_healthy: bool = True
    data_is_mock: bool = False
    allow_mock: bool = False  # True only in tests/demo
    upcoming_events: list[EconomicEvent] = field(default_factory=list)
    underlying_spread_bps: float | None = None
    disabled_strategies: frozenset[str] = frozenset()


@dataclass
class SignalProposal:
    strategy: str
    symbol: str
    direction: str
    score: float
    reward_risk: float
    is_option: bool = False
    is_0dte: bool = False
    is_naked_short: bool = False
    option_spread_ok: bool = True
    has_explanation_for_conflict: bool = False


@dataclass
class RiskDecision:
    approved: bool
    violations: list[str]

    def __bool__(self) -> bool:
        return self.approved


def circuit_breaker_tripped(recent_r: list[float], p: RiskPolicy) -> str | None:
    streak = 0
    for r in reversed(recent_r):
        if r < 0:
            streak += 1
        else:
            break
    if streak >= p.circuit_breaker_consecutive_losses:
        return f"{streak} consecutive losses"
    window = recent_r[-p.circuit_breaker_rolling_n:]
    if len(window) >= p.circuit_breaker_rolling_n:
        exp = sum(window) / len(window)
        if exp < p.circuit_breaker_min_expectancy_r:
            return f"rolling expectancy {exp:.2f}R"
    return None


def evaluate(s: SignalProposal, ctx: RiskContext, p: RiskPolicy = RiskPolicy()) -> RiskDecision:
    v: list[str] = []
    now = ensure_utc(ctx.now)
    if ctx.kill_switch:
        v.append("kill switch active")
    if not ctx.data_healthy:
        v.append("market data feed unhealthy")
    if ctx.data_is_mock and not ctx.allow_mock:
        v.append("mock data cannot produce real signals")
    if s.strategy not in p.enabled_strategies:
        v.append(f"strategy '{s.strategy}' not enabled (not validated)")
    if s.strategy in ctx.disabled_strategies:
        v.append(f"strategy '{s.strategy}' disabled by quality monitor")
    if (cb := circuit_breaker_tripped(ctx.recent_r, p)):
        v.append(f"circuit breaker: {cb}")
    if ctx.realized_r_today <= -p.daily_loss_limit_r:
        v.append(f"daily loss limit reached ({ctx.realized_r_today:.1f}R)")
    if s.score < p.min_score:
        v.append(f"score {s.score:.0f} < {p.min_score:.0f}")
    if s.reward_risk < p.min_reward_risk:
        v.append(f"R:R {s.reward_risk:.2f} < {p.min_reward_risk}")
    if not is_regular_session(now):
        v.append("outside regular session")
    else:
        if minutes_since_open(now) < p.no_entry_first_minutes:
            v.append("too close to the open")
        if minutes_to_close(now) < p.no_entry_last_minutes:
            v.append("too close to the close")
    if ctx.underlying_spread_bps is not None and ctx.underlying_spread_bps > p.max_underlying_spread_bps:
        v.append(f"underlying spread {ctx.underlying_spread_bps:.1f}bps too wide")
    if s.is_option and not s.option_spread_ok:
        v.append("option liquidity/spread filter failed")
    if s.is_naked_short and not p.allow_naked_short_options:
        v.append("naked short options are not allowed")
    if s.is_0dte:
        if not p.zero_dte_enabled:
            v.append("0DTE signals disabled")
        elif sum(o.is_0dte for o in ctx.open_signals) >= p.zero_dte_max_open:
            v.append("0DTE exposure limit")
    for ev in ctx.upcoming_events:
        if ev.importance == "high" or any(k in ev.name.upper() for k in p.high_impact_events):
            at = ensure_utc(ev.at)
            if at - p.event_blackout_before <= now <= at + p.event_blackout_after:
                v.append(f"event blackout: {ev.name}")
    if len(ctx.open_signals) >= p.max_open_signals:
        v.append("max open signals reached")
    group = get_spec(s.symbol).correlation_group
    same_group = [o for o in ctx.open_signals if get_spec(o.symbol).correlation_group == group]
    if len(same_group) >= p.max_open_per_correlation_group:
        v.append(f"correlated exposure limit ({group})")
    conflicting = [o for o in same_group if o.direction != s.direction]
    if conflicting and not s.has_explanation_for_conflict:
        v.append(f"conflicts with open {conflicting[0].ref} without explanation")
    return RiskDecision(not v, v)
