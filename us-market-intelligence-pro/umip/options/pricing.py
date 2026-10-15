"""Black-Scholes-Merton pricing, Greeks and implied volatility.

European model. Fine for SPX/NDX/RUT (European). For American ETF/stock options
it is an approximation (early exercise ignored) — acceptable for short-dated
calls on low-dividend underlyings, and used only for scenario estimates, never
as a quoted price (quotes always come from the live bid/ask).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

SQRT2 = math.sqrt(2.0)


def _ncdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / SQRT2))


def _npdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2 * math.pi)


def _d1d2(s: float, k: float, t: float, r: float, sigma: float, q: float) -> tuple[float, float]:
    vt = sigma * math.sqrt(t)
    d1 = (math.log(s / k) + (r - q + 0.5 * sigma * sigma) * t) / vt
    return d1, d1 - vt


def bs_price(s: float, k: float, t: float, r: float, sigma: float, right: str,
             q: float = 0.0) -> float:
    if t <= 0 or sigma <= 0:
        return max(0.0, s - k) if right == "C" else max(0.0, k - s)
    d1, d2 = _d1d2(s, k, t, r, sigma, q)
    if right == "C":
        return s * math.exp(-q * t) * _ncdf(d1) - k * math.exp(-r * t) * _ncdf(d2)
    return k * math.exp(-r * t) * _ncdf(-d2) - s * math.exp(-q * t) * _ncdf(-d1)


@dataclass(frozen=True)
class Greeks:
    delta: float
    gamma: float
    theta: float  # per calendar day
    vega: float  # per 1 vol point (0.01)


def bs_greeks(s: float, k: float, t: float, r: float, sigma: float, right: str,
              q: float = 0.0) -> Greeks:
    if t <= 0 or sigma <= 0:
        itm = (s > k) if right == "C" else (s < k)
        return Greeks((1.0 if right == "C" else -1.0) if itm else 0.0, 0.0, 0.0, 0.0)
    d1, d2 = _d1d2(s, k, t, r, sigma, q)
    eqt, ert = math.exp(-q * t), math.exp(-r * t)
    gamma = eqt * _npdf(d1) / (s * sigma * math.sqrt(t))
    vega = s * eqt * _npdf(d1) * math.sqrt(t) / 100
    common = -s * eqt * _npdf(d1) * sigma / (2 * math.sqrt(t))
    if right == "C":
        delta = eqt * _ncdf(d1)
        theta = common - r * k * ert * _ncdf(d2) + q * s * eqt * _ncdf(d1)
    else:
        delta = -eqt * _ncdf(-d1)
        theta = common + r * k * ert * _ncdf(-d2) - q * s * eqt * _ncdf(-d1)
    return Greeks(delta, gamma, theta / 365, vega)


def implied_vol(price: float, s: float, k: float, t: float, r: float, right: str,
                q: float = 0.0, lo: float = 1e-4, hi: float = 5.0, tol: float = 1e-6) -> float | None:
    """Bisection (robust; no derivative blow-ups for deep OTM). None if no solution."""
    intrinsic = max(0.0, s - k) if right == "C" else max(0.0, k - s)
    if price < intrinsic - 1e-9 or t <= 0:
        return None
    f_lo = bs_price(s, k, t, r, lo, right, q) - price
    f_hi = bs_price(s, k, t, r, hi, right, q) - price
    if f_lo * f_hi > 0:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        f_mid = bs_price(s, k, t, r, mid, right, q) - price
        if abs(f_mid) < tol:
            return mid
        if f_lo * f_mid < 0:
            hi, f_hi = mid, f_mid
        else:
            lo, f_lo = mid, f_mid
    return (lo + hi) / 2


def iv_rank(current: float, history: list[float]) -> float | None:
    if not history:
        return None
    lo, hi = min(history), max(history)
    return None if hi == lo else 100 * (current - lo) / (hi - lo)


def iv_percentile(current: float, history: list[float]) -> float | None:
    if not history:
        return None
    return 100 * sum(1 for h in history if h < current) / len(history)
