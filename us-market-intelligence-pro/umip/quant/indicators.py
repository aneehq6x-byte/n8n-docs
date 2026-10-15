"""Technical indicators. Pure functions over numpy arrays, causal (value at i
uses only data <= i). Warm-up positions are NaN."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

import numpy as np

from umip.market_data.base import Bar
from umip.timeutil import NY, RTH_OPEN


def arr(bars: Sequence[Bar], field: str) -> np.ndarray:
    return np.array([getattr(b, field) for b in bars], dtype=float)


def sma(x: np.ndarray, n: int) -> np.ndarray:
    out = np.full_like(x, np.nan)
    if len(x) >= n:
        c = np.cumsum(np.insert(x, 0, 0.0))
        out[n - 1:] = (c[n:] - c[:-n]) / n
    return out


def ema(x: np.ndarray, n: int) -> np.ndarray:
    out = np.full_like(x, np.nan)
    if len(x) < n:
        return out
    k = 2 / (n + 1)
    out[n - 1] = x[:n].mean()
    for i in range(n, len(x)):
        out[i] = x[i] * k + out[i - 1] * (1 - k)
    return out


def _wilder(x: np.ndarray, n: int, start: int) -> np.ndarray:
    """Wilder smoothing where x[start:start+n] seeds the first value."""
    out = np.full_like(x, np.nan)
    if len(x) < start + n:
        return out
    out[start + n - 1] = x[start:start + n].mean()
    for i in range(start + n, len(x)):
        out[i] = (out[i - 1] * (n - 1) + x[i]) / n
    return out


def rsi(close: np.ndarray, n: int = 14) -> np.ndarray:
    d = np.diff(close, prepend=np.nan)
    gain, loss = np.where(d > 0, d, 0.0), np.where(d < 0, -d, 0.0)
    ag, al = _wilder(gain, n, 1), _wilder(loss, n, 1)
    with np.errstate(divide="ignore", invalid="ignore"):
        rs = ag / al
        out = 100 - 100 / (1 + rs)
    out[(al == 0) & ~np.isnan(ag)] = 100.0
    return out


def macd(close: np.ndarray, fast: int = 12, slow: int = 26, signal: int = 9):
    line = ema(close, fast) - ema(close, slow)
    sig = np.full_like(line, np.nan)
    valid = ~np.isnan(line)
    if valid.sum() >= signal:
        first = int(np.argmax(valid))
        sig[first:] = ema(line[first:], signal)
    return line, sig, line - sig


def true_range(high: np.ndarray, low: np.ndarray, close: np.ndarray) -> np.ndarray:
    prev = np.roll(close, 1)
    tr = np.maximum.reduce([high - low, np.abs(high - prev), np.abs(low - prev)])
    tr[0] = high[0] - low[0]
    return tr


def atr(high, low, close, n: int = 14) -> np.ndarray:
    return _wilder(true_range(high, low, close), n, 0)


def adx(high, low, close, n: int = 14) -> np.ndarray:
    up = np.diff(high, prepend=np.nan)
    down = -np.diff(low, prepend=np.nan)
    plus_dm = np.where((up > down) & (up > 0), up, 0.0)
    minus_dm = np.where((down > up) & (down > 0), down, 0.0)
    tr = true_range(high, low, close)
    s_tr, s_p, s_m = _wilder(tr, n, 1), _wilder(plus_dm, n, 1), _wilder(minus_dm, n, 1)
    with np.errstate(divide="ignore", invalid="ignore"):
        pdi, mdi = 100 * s_p / s_tr, 100 * s_m / s_tr
        dx = 100 * np.abs(pdi - mdi) / (pdi + mdi)
    first = int(np.argmax(~np.isnan(dx))) if (~np.isnan(dx)).any() else len(dx)
    out = np.full_like(dx, np.nan)
    if len(dx) - first >= n:
        out[first:] = _wilder(dx[first:], n, 0)
    return out


def vwap_session(bars: Sequence[Bar]) -> np.ndarray:
    """Session VWAP resetting each New York trading day (typical price)."""
    out = np.empty(len(bars))
    pv = vol = 0.0
    day = None
    for i, b in enumerate(bars):
        d = b.ts.astimezone(NY).date()
        if d != day:
            pv = vol = 0.0
            day = d
        tp = (b.high + b.low + b.close) / 3
        pv += tp * b.volume
        vol += b.volume
        out[i] = pv / vol if vol else np.nan
    return out


def anchored_vwap(bars: Sequence[Bar], anchor: datetime) -> np.ndarray:
    out = np.full(len(bars), np.nan)
    pv = vol = 0.0
    for i, b in enumerate(bars):
        if b.ts < anchor:
            continue
        tp = (b.high + b.low + b.close) / 3
        pv += tp * b.volume
        vol += b.volume
        out[i] = pv / vol if vol else np.nan
    return out


def relative_volume(volume: np.ndarray, n: int = 20) -> np.ndarray:
    """Volume vs. average of the *previous* n bars (no look-ahead)."""
    prev = np.roll(sma(volume, n), 1)
    prev[0] = np.nan
    with np.errstate(divide="ignore", invalid="ignore"):
        return volume / prev


def opening_range(bars: Sequence[Bar], minutes: int = 15) -> tuple[float, float] | None:
    """High/low of the first ``minutes`` of today's regular session in ``bars``."""
    if not bars:
        return None
    day = bars[-1].ts.astimezone(NY).date()
    start = datetime.combine(day, RTH_OPEN, tzinfo=NY)
    hi, lo = -np.inf, np.inf
    found = False
    for b in bars:
        t = b.ts.astimezone(NY)
        if t.date() == day and start <= t and (t - start).total_seconds() < minutes * 60:
            hi, lo, found = max(hi, b.high), min(lo, b.low), True
    return (hi, lo) if found else None


def previous_day_hl(daily: Sequence[Bar], today) -> tuple[float, float] | None:
    prior = [b for b in daily if b.ts.astimezone(NY).date() < today]
    return (prior[-1].high, prior[-1].low) if prior else None


def swing_levels(high: np.ndarray, low: np.ndarray, k: int = 3) -> tuple[list[int], list[int]]:
    """Confirmed pivot highs/lows (needs k bars after; caller must respect the lag)."""
    hs, ls = [], []
    for i in range(k, len(high) - k):
        if high[i] == high[i - k:i + k + 1].max():
            hs.append(i)
        if low[i] == low[i - k:i + k + 1].min():
            ls.append(i)
    return hs, ls


def volatility_regime(close: np.ndarray, n: int = 20, lookback: int = 250) -> str:
    """'low' | 'normal' | 'high' realised-vol regime vs its own history."""
    r = np.diff(np.log(close))
    if len(r) < n + 5:
        return "unknown"
    vols = np.array([r[i - n:i].std() for i in range(n, len(r) + 1)])
    hist = vols[-lookback:]
    pct = (hist < vols[-1]).mean()
    return "low" if pct < 0.25 else "high" if pct > 0.75 else "normal"
