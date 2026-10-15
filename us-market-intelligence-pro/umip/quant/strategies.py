"""Deterministic strategies producing *candidates*.

A strategy sees only bars up to and including the last closed bar. It returns
``None`` when there is no setup — "no trade" is a valid, common answer.
Strategies are disabled by default until they pass the acceptance gate in
``backtest.acceptance``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Protocol

import numpy as np

from umip.market_data.base import Bar
from umip.quant import indicators as ind
from umip.timeutil import NY, RTH_OPEN, ensure_utc, minutes_since_open, minutes_to_close


@dataclass(frozen=True)
class Candidate:
    strategy: str
    symbol: str
    direction: str  # long | short
    detected_at: datetime
    reference_price: float
    entry_low: float
    entry_high: float
    stop: float
    target1: float
    target2: float
    invalidation: str
    reason: str
    valid_for: timedelta
    expected_hold_minutes: int
    score: float
    features: dict = field(default_factory=dict)

    @property
    def reward_risk(self) -> float:
        entry = (self.entry_low + self.entry_high) / 2
        risk = abs(entry - self.stop)
        return abs(self.target1 - entry) / risk if risk else 0.0


class Strategy(Protocol):
    name: str
    timeframe: str

    def evaluate(self, symbol: str, bars: list[Bar]) -> Candidate | None: ...


def _session_bars(bars: list[Bar]) -> list[Bar]:
    day = bars[-1].ts.astimezone(NY).date()
    start = datetime.combine(day, RTH_OPEN, tzinfo=NY)
    return [b for b in bars if b.ts.astimezone(NY) >= start and b.ts.astimezone(NY).date() == day]


class OpeningRangeBreakout:
    """Close beyond the N-minute opening range, above/below session VWAP, with
    relative volume confirmation. Stop at the far side of the range midpoint."""

    name = "orb"
    timeframe = "5m"

    def __init__(self, or_minutes: int = 15, min_rvol: float = 1.2, last_entry_minutes: int = 120,
                 atr_n: int = 14):
        self.or_minutes = or_minutes
        self.min_rvol = min_rvol
        self.last_entry_minutes = last_entry_minutes
        self.atr_n = atr_n

    def evaluate(self, symbol: str, bars: list[Bar]) -> Candidate | None:
        if len(bars) < 30:
            return None
        last = bars[-1]
        now = ensure_utc(last.ts) + timedelta(minutes=5)  # bar close time
        since = minutes_since_open(now)
        if since < self.or_minutes or since > self.last_entry_minutes or minutes_to_close(now) < 60:
            return None
        rng = ind.opening_range(bars, self.or_minutes)
        if rng is None:
            return None
        hi, lo = rng
        session = _session_bars(bars)
        vw = ind.vwap_session(session)[-1]
        rv = ind.relative_volume(ind.arr(bars, "volume"))[-1]
        a = ind.atr(ind.arr(bars, "high"), ind.arr(bars, "low"), ind.arr(bars, "close"),
                    self.atr_n)[-1]
        if np.isnan(a) or np.isnan(rv) or rv < self.min_rvol:
            return None
        prev_close = bars[-2].close
        mid = (hi + lo) / 2
        width = hi - lo
        # Stop: the tighter of range midpoint and 1 ATR. Targets: measured move or
        # a multiple of the risk, whichever is further.
        if last.close > hi >= prev_close and last.close > vw:
            direction, stop = "long", max(mid, last.close - a)
            risk = last.close - stop
            t1 = last.close + max(width, 1.5 * risk)
            t2 = last.close + max(2 * width, 3 * risk)
            inval = f"5m close back inside range below {hi:.2f}"
        elif last.close < lo <= prev_close and last.close < vw:
            direction, stop = "short", min(mid, last.close + a)
            risk = stop - last.close
            t1 = last.close - max(width, 1.5 * risk)
            t2 = last.close - max(2 * width, 3 * risk)
            inval = f"5m close back inside range above {lo:.2f}"
        else:
            return None
        if risk <= 0:
            return None
        entry_pad = 0.1 * a
        c = Candidate(self.name, symbol, direction, now, last.close,
                      last.close - entry_pad, last.close + entry_pad, stop, t1, t2, inval,
                      f"ORB{self.or_minutes} break, RVOL {rv:.1f}, price vs VWAP {last.close - vw:+.2f}",
                      timedelta(minutes=20), 60, 0.0,
                      {"or_high": hi, "or_low": lo, "vwap": vw, "rvol": rv, "atr": a})
        score = min(rv / 3, 1) * 40 + min(c.reward_risk / 3, 1) * 40 + 20 * (since < 60)
        return Candidate(**{**c.__dict__, "score": round(score, 1)})


class VwapTrendContinuation:
    """Trend (EMA20>EMA50, ADX>20) pullback to session VWAP that holds, then a close
    back in trend direction."""

    name = "vwap_trend"
    timeframe = "5m"

    def __init__(self, adx_min: float = 20.0, touch_atr: float = 0.25):
        self.adx_min = adx_min
        self.touch_atr = touch_atr

    def evaluate(self, symbol: str, bars: list[Bar]) -> Candidate | None:
        if len(bars) < 60:
            return None
        last, prev = bars[-1], bars[-2]
        now = ensure_utc(last.ts) + timedelta(minutes=5)
        if minutes_since_open(now) < 30 or minutes_to_close(now) < 60:
            return None
        session = _session_bars(bars)
        if len(session) < 6:
            return None
        h, l, c = ind.arr(bars, "high"), ind.arr(bars, "low"), ind.arr(bars, "close")
        e20, e50 = ind.ema(c, 20)[-1], ind.ema(c, 50)[-1]
        ax, a = ind.adx(h, l, c)[-1], ind.atr(h, l, c)[-1]
        vw = ind.vwap_session(session)
        if any(np.isnan(v) for v in (e20, e50, ax, a, vw[-1])) or ax < self.adx_min:
            return None
        tol = self.touch_atr * a
        if e20 > e50 and prev.low <= vw[-2] + tol and prev.close > vw[-2] and last.close > prev.high:
            d, stop = "long", min(prev.low, vw[-1]) - 0.25 * a
            t1, t2 = last.close + 1.5 * (last.close - stop), last.close + 3 * (last.close - stop)
            inval = f"close below VWAP {vw[-1]:.2f}"
        elif e20 < e50 and prev.high >= vw[-2] - tol and prev.close < vw[-2] and last.close < prev.low:
            d, stop = "short", max(prev.high, vw[-1]) + 0.25 * a
            t1, t2 = last.close - 1.5 * (stop - last.close), last.close - 3 * (stop - last.close)
            inval = f"close above VWAP {vw[-1]:.2f}"
        else:
            return None
        score = min(ax / 40, 1) * 50 + 30 + 20 * (abs(e20 - e50) / a > 0.5)
        return Candidate(self.name, symbol, d, now, last.close, last.close - 0.1 * a,
                         last.close + 0.1 * a, stop, t1, t2, inval,
                         f"Trend pullback to VWAP held (ADX {ax:.0f})", timedelta(minutes=20), 90,
                         round(score, 1), {"ema20": e20, "ema50": e50, "adx": ax, "vwap": vw[-1],
                                           "atr": a})


REGISTRY: dict[str, type] = {"orb": OpeningRangeBreakout, "vwap_trend": VwapTrendContinuation}
# Implemented next (see ROADMAP): momentum_breakout, trend_pullback, vol_expansion,
# mean_reversion, event_driven, relative_strength_selection.
