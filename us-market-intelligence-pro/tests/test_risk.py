from __future__ import annotations

from datetime import datetime, timedelta, timezone

from tests.conftest import MARKET_NOW
from umip.market_data.base import EconomicEvent
from umip.risk.engine import OpenSignal, RiskContext, RiskPolicy, SignalProposal, evaluate

POLICY = RiskPolicy(enabled_strategies=frozenset({"orb"}))


def _p(**kw):
    base = dict(strategy="orb", symbol="SPY", direction="long", score=75, reward_risk=2.0)
    base.update(kw)
    return SignalProposal(**base)


def _ctx(**kw):
    base = dict(now=MARKET_NOW)
    base.update(kw)
    return RiskContext(**base)


def test_clean_signal_approved():
    d = evaluate(_p(), _ctx(), POLICY)
    assert d.approved, d.violations


def test_defaults_are_conservative():
    d = evaluate(_p(), _ctx())
    assert not d.approved and any("not enabled" in v for v in d.violations)
    assert RiskPolicy().zero_dte_enabled is False and RiskPolicy().allow_naked_short_options is False


def _has(d, text):
    return not d.approved and any(text in v for v in d.violations)


def test_vetoes():
    assert _has(evaluate(_p(), _ctx(kill_switch=True), POLICY), "kill switch")
    assert _has(evaluate(_p(), _ctx(data_healthy=False), POLICY), "unhealthy")
    assert _has(evaluate(_p(), _ctx(data_is_mock=True), POLICY), "mock")
    assert evaluate(_p(), _ctx(data_is_mock=True, allow_mock=True), POLICY).approved
    assert _has(evaluate(_p(score=40), _ctx(), POLICY), "score")
    assert _has(evaluate(_p(reward_risk=1.0), _ctx(), POLICY), "R:R")
    assert _has(evaluate(_p(is_0dte=True), _ctx(), POLICY), "0DTE")
    assert _has(evaluate(_p(is_naked_short=True), _ctx(), POLICY), "naked")
    assert _has(evaluate(_p(), _ctx(realized_r_today=-3.0), POLICY), "daily loss")
    assert _has(evaluate(_p(), _ctx(underlying_spread_bps=12), POLICY), "spread")
    assert _has(evaluate(_p(), _ctx(disabled_strategies=frozenset({"orb"})), POLICY), "quality")


def test_session_timing():
    pre = datetime(2026, 3, 10, 13, 0, tzinfo=timezone.utc)
    near_close = datetime(2026, 3, 10, 19, 45, tzinfo=timezone.utc)
    just_open = datetime(2026, 3, 10, 13, 32, tzinfo=timezone.utc)
    assert _has(evaluate(_p(), _ctx(now=pre), POLICY), "outside")
    assert _has(evaluate(_p(), _ctx(now=near_close), POLICY), "close")
    assert _has(evaluate(_p(), _ctx(now=just_open), POLICY), "open")


def test_event_blackout():
    ev = EconomicEvent("CPI", MARKET_NOW + timedelta(minutes=10), "high", "test")
    assert _has(evaluate(_p(), _ctx(upcoming_events=[ev]), POLICY), "blackout")
    far = EconomicEvent("CPI", MARKET_NOW + timedelta(hours=3), "high", "test")
    assert evaluate(_p(), _ctx(upcoming_events=[far]), POLICY).approved


def test_correlated_and_conflicting_exposure():
    open_spx = [OpenSignal("UM-1", "SPX", "short", False)]
    d = evaluate(_p(), _ctx(open_signals=open_spx), POLICY)
    assert _has(d, "correlated") and _has(d, "conflicts")
    assert evaluate(_p(symbol="IWM"), _ctx(open_signals=open_spx), POLICY).approved


def test_circuit_breaker():
    assert _has(evaluate(_p(), _ctx(recent_r=[1, -1, -1, -1, -1]), POLICY), "consecutive")
    bad = [-0.5, 0.2] * 10
    assert _has(evaluate(_p(), _ctx(recent_r=bad), POLICY), "rolling expectancy")
