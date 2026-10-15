from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pytest

from tests.conftest import MARKET_NOW
from umip.instruments import ExerciseStyle, Settlement, get_spec
from umip.market_data.base import Bar, OptionChain, OptionQuote
from umip.options.pricing import bs_greeks, bs_price, implied_vol, iv_percentile, iv_rank
from umip.options.selector import OptionsPolicy, UnderlyingPlan, evaluate_contract, select_contract
from umip.quant import backtest as bt
from umip.quant import indicators as ind
from umip.quant.strategies import Candidate, OpeningRangeBreakout
from umip.timeutil import format_dual, is_regular_session, is_trading_day, minutes_to_close

UTC = timezone.utc


# ------------------------------------------------------------------- time

def test_dual_time_respects_us_dst():
    winter = datetime(2026, 1, 13, 15, 5, tzinfo=UTC)   # 10:05 EST
    summer = datetime(2026, 3, 10, 14, 5, tzinfo=UTC)   # 10:05 EDT
    assert format_dual(winter) == "2026-01-13 10:05 EST | 18:05 Riyadh"
    assert format_dual(summer) == "2026-03-10 10:05 EDT | 17:05 Riyadh"


def test_sessions_and_holidays():
    assert is_regular_session(MARKET_NOW)
    assert not is_regular_session(datetime(2026, 3, 10, 13, 0, tzinfo=UTC))  # 09:00 ET
    assert not is_trading_day(date(2026, 11, 26))  # Thanksgiving
    assert not is_trading_day(date(2026, 3, 14))   # Saturday
    early = datetime(2026, 11, 27, 17, 30, tzinfo=UTC)  # 12:30 ET on an early-close day
    assert minutes_to_close(early) == 30


def test_spx_and_spy_are_not_interchangeable():
    spx, spy = get_spec("SPX"), get_spec("SPY")
    assert spx.options_exercise == ExerciseStyle.EUROPEAN and spx.options_settlement == Settlement.CASH
    assert spy.options_exercise == ExerciseStyle.AMERICAN and spy.options_settlement == Settlement.PHYSICAL
    assert not spx.tradable_underlying and spy.tradable_underlying
    assert spx.correlation_group == spy.correlation_group
    assert get_spec("AAPL").correlation_group == "stock:AAPL"


# ---------------------------------------------------------------- pricing

def test_put_call_parity_and_iv_roundtrip():
    s, k, t, r = 600.0, 605.0, 30 / 365, 0.04
    c, p = bs_price(s, k, t, r, 0.2, "C"), bs_price(s, k, t, r, 0.2, "P")
    assert c - p == pytest.approx(s - k * math.exp(-r * t), abs=1e-9)
    assert implied_vol(c, s, k, t, r, "C") == pytest.approx(0.2, abs=1e-5)
    assert implied_vol(0.0001, s, k, t, r, "C") is None or implied_vol(0.0001, s, k, t, r, "C") < 0.05


def test_greeks_signs_and_finite_difference():
    s, k, t, r, v = 600.0, 600.0, 7 / 365, 0.04, 0.18
    g = bs_greeks(s, k, t, r, v, "C")
    assert 0.45 < g.delta < 0.6 and g.gamma > 0 and g.theta < 0 and g.vega > 0
    h = 0.01
    fd = (bs_price(s + h, k, t, r, v, "C") - bs_price(s - h, k, t, r, v, "C")) / (2 * h)
    assert g.delta == pytest.approx(fd, rel=1e-4)
    assert bs_greeks(s, k, t, r, v, "P").delta == pytest.approx(g.delta - 1, abs=1e-9)


def test_iv_rank_percentile():
    hist = [0.1, 0.2, 0.3, 0.4]
    assert iv_rank(0.25, hist) == pytest.approx(50)
    assert iv_percentile(0.25, hist) == 50


# ------------------------------------------------------------- indicators

def _bars(closes, start=datetime(2026, 3, 10, 13, 30, tzinfo=UTC), step=5, vol=1000.0):
    out = []
    for i, c in enumerate(closes):
        o = closes[i - 1] if i else c
        out.append(Bar(start + timedelta(minutes=step * i), o, max(o, c) + 0.1, min(o, c) - 0.1, c, vol))
    return out


def test_sma_ema_rsi_basic():
    x = np.arange(1, 31, dtype=float)
    assert ind.sma(x, 5)[4] == 3 and np.isnan(ind.sma(x, 5)[3])
    assert ind.ema(x, 5)[4] == 3
    r = ind.rsi(x, 14)
    assert r[-1] == 100.0 and np.isnan(r[13])
    r2 = ind.rsi(np.array([10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10, 11.0]), 14)
    assert 40 < r2[-1] < 60


def test_indicators_are_causal():
    rng = np.random.default_rng(0)
    c = 100 + np.cumsum(rng.normal(0, 1, 300))
    h, l = c + 0.5, c - 0.5
    for fn in (lambda a, b, cc: ind.atr(a, b, cc), lambda a, b, cc: ind.adx(a, b, cc),
               lambda a, b, cc: ind.rsi(cc), lambda a, b, cc: ind.macd(cc)[1],
               lambda a, b, cc: ind.relative_volume(cc)):
        full = fn(h, l, c)
        part = fn(h[:200], l[:200], c[:200])
        np.testing.assert_allclose(full[:200], part, equal_nan=True)


def test_vwap_resets_each_session_and_opening_range():
    day1 = _bars([100, 101, 102], start=datetime(2026, 3, 9, 13, 30, tzinfo=UTC))
    day2 = _bars([200, 202, 204, 206], start=datetime(2026, 3, 10, 13, 30, tzinfo=UTC))
    v = ind.vwap_session(day1 + day2)
    assert v[3] == pytest.approx((200 + 200.1 + 199.9) / 3)
    hi, lo = ind.opening_range(day1 + day2, 15)
    assert hi == pytest.approx(204.1) and lo == pytest.approx(199.9)


# ------------------------------------------------------------- strategies

def test_orb_detects_breakout_and_says_no_trade_otherwise():
    flat = [100.0] * 3 + [100.2, 99.9, 100.1, 100.0, 99.95, 100.05]
    pre = _bars([100 + 0.01 * (i % 3) for i in range(30)],
                start=datetime(2026, 3, 9, 13, 30, tzinfo=UTC))
    today = _bars(flat, start=datetime(2026, 3, 10, 13, 30, tzinfo=UTC))
    s = OpeningRangeBreakout(min_rvol=1.0)
    assert s.evaluate("SPY", pre + today) is None
    brk = Bar(today[-1].ts + timedelta(minutes=5), 100.05, 101.6, 100.0, 101.5, 5000.0)
    c = s.evaluate("SPY", pre + today + [brk])
    assert c is not None and c.direction == "long" and c.stop < 101.5 < c.target1 < c.target2
    assert c.reward_risk > 1


# ---------------------------------------------------------------- options

def _chain(spot=600.0, expiry=date(2026, 3, 13), now=MARKET_NOW, **overrides):
    t = (datetime(2026, 3, 13, 20, 0, tzinfo=UTC) - now).total_seconds() / (365 * 86400)
    quotes = []
    for strike in (590.0, 595.0, 600.0, 605.0, 610.0):
        for right in ("C", "P"):
            px = bs_price(spot, strike, t, 0.04, 0.18, right)
            g = bs_greeks(spot, strike, t, 0.04, 0.18, right)
            q = dict(contract=f"SPY260313{right}{int(strike*1000):08d}", underlying="SPY",
                     right=right, strike=strike, expiry=expiry, bid=round(px - 0.03, 2),
                     ask=round(px + 0.03, 2), last=px, volume=3000, open_interest=8000, iv=0.18,
                     delta=g.delta, gamma=g.gamma, theta=g.theta, vega=g.vega, as_of=now,
                     source="TEST")
            q.update(overrides)
            quotes.append(OptionQuote(**q))
    return OptionChain("SPY", spot, quotes, now, "TEST")


PLAN = UnderlyingPlan("SPY", "long", 600.0, 606.0, 610.0, 597.0, 60)


def test_selects_liquid_call_with_edge():
    best, evals = select_contract(_chain(), PLAN, MARKET_NOW)
    assert best is not None and best.quote.right == "C"
    assert best.reward_risk >= 1.5 and best.entry_price > best.quote.mid
    assert all(e.quote.right == "C" for e in evals if e.accepted)
    s = best.summary()
    assert s["source"] == "TEST" and s["max_loss_per_contract"] == pytest.approx(best.entry_price * 100)


@pytest.mark.parametrize("override,reason", [
    ({"open_interest": 10}, "OI"),
    ({"volume": 1}, "volume"),
    ({"bid": 0.5, "ask": 2.5}, "spread"),
    ({"iv": None}, "greeks"),
])
def test_rejects_illiquid_or_incomplete(override, reason):
    best, evals = select_contract(_chain(**override), PLAN, MARKET_NOW)
    assert best is None
    assert any(reason in r for e in evals for r in e.reasons)


def test_rejects_when_target_too_close_for_costs():
    plan = UnderlyingPlan("SPY", "long", 600.0, 600.3, 601.0, 599.0, 60)
    best, evals = select_contract(_chain(), plan, MARKET_NOW)
    assert best is None


def test_0dte_blocked_near_close_and_when_disabled():
    late = datetime(2026, 3, 13, 19, 30, tzinfo=UTC)  # 15:30 ET Friday, expiry day
    ch = _chain(now=late)
    q = next(x for x in ch.quotes if x.right == "C" and x.strike == 600.0)
    ev = evaluate_contract(q, PLAN, late, OptionsPolicy())
    assert any("min to close" in r for r in ev.reasons)
    ev2 = evaluate_contract(q, PLAN, late, OptionsPolicy(allow_0dte=False))
    assert any("0DTE disabled" in r for r in ev2.reasons)


# --------------------------------------------------------------- backtest

def _cand(**kw):
    base = dict(strategy="t", symbol="SPY", direction="long",
                detected_at=datetime(2026, 3, 10, 14, 0, tzinfo=UTC), reference_price=100.0,
                entry_low=99.9, entry_high=100.1, stop=99.0, target1=102.0, target2=104.0,
                invalidation="x", reason="x", valid_for=timedelta(minutes=15),
                expected_hold_minutes=60, score=70.0)
    base.update(kw)
    return Candidate(**base)


def _b(minute, o, h, l, c):
    return Bar(datetime(2026, 3, 10, 14, 0, tzinfo=UTC) + timedelta(minutes=minute), o, h, l, c, 1000)


def test_unfilled_signal_is_expired_not_loss():
    t = bt.simulate(_cand(), [_b(5, 101, 101.5, 100.5, 101), _b(20, 101, 101.2, 100.8, 101)],
                    bt.Costs())
    assert t.outcome == "expired" and t.r_multiple == 0


def test_stop_assumed_first_when_both_in_one_bar():
    t = bt.simulate(_cand(), [_b(5, 100, 100.05, 99.95, 100), _b(10, 100, 103, 98.5, 101)],
                    bt.Costs(0, 0))
    assert t.outcome == "stop" and t.r_multiple == pytest.approx(-1.0)


def test_target_hit_after_costs_is_less_than_gross():
    t = bt.simulate(_cand(), [_b(5, 100, 100.05, 99.95, 100), _b(10, 100, 102.5, 99.8, 102)],
                    bt.Costs())
    assert t.outcome == "target1" and 0 < t.r_multiple < 2.0


def test_metrics_exclude_expired_and_acceptance_gate():
    trades = [bt.Trade(_cand(), "target1", r_multiple=2.0), bt.Trade(_cand(), "stop", r_multiple=-1.0),
              bt.Trade(_cand(), "expired")]
    m = bt.metrics(trades)
    assert m.n_trades == 2 and m.n_expired == 1 and m.win_rate == 0.5
    assert m.profit_factor == 2.0 and m.expectancy_r == 0.5 and m.max_drawdown_r == 1.0
    ok, fails = bt.acceptance(m, m)
    assert not ok and any("OOS trades" in f for f in fails)
    splits = list(bt.walk_forward_splits(100, 4))
    assert all(tr.stop <= te.start for tr, te in splits) and splits[-1][1].stop == 100
    assert bt.monte_carlo_drawdown([1, -1, 1, -1, -1, 2] * 10) >= 2.0
