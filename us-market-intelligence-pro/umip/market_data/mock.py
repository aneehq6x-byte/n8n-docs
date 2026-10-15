"""Deterministic MOCK provider for tests and local demos only.

Every object it returns has ``is_mock=True`` and ``source="MOCK"``; the signal
validator refuses to publish anything derived from it outside test mode.
"""

from __future__ import annotations

import math
import random
from datetime import date, datetime, timedelta

from umip.market_data.base import Bar, EconomicEvent, OptionChain, OptionQuote, Quote
from umip.options.pricing import bs_greeks, bs_price
from umip.timeutil import NY, utcnow

SOURCE = "MOCK"
BASE_PRICES = {"SPX": 6000.0, "SPY": 600.0, "NDX": 21000.0, "QQQ": 510.0, "RUT": 2300.0,
               "IWM": 228.0, "DIA": 440.0, "VIX": 16.0}


class MockProvider:
    name = SOURCE
    is_mock = True

    def __init__(self, seed: int = 7, now_fn=utcnow, age_seconds: float = 0.0):
        self.seed = seed
        self.now_fn = now_fn
        self.age = timedelta(seconds=age_seconds)  # simulate stale feeds in tests

    def _price(self, symbol: str) -> float:
        return BASE_PRICES.get(symbol.upper(), 100.0)

    async def quote(self, symbol: str) -> Quote:
        p = self._price(symbol)
        return Quote(symbol.upper(), p, p - 0.01, p + 0.01, self.now_fn() - self.age, SOURCE, True)

    async def bars(self, symbol: str, timeframe: str, start: datetime, end: datetime) -> list[Bar]:
        step = {"1m": 1, "5m": 5, "15m": 15, "1h": 60, "1d": 1440}[timeframe]
        rng = random.Random(f"{self.seed}:{symbol}:{timeframe}")
        price = self._price(symbol)
        out, t = [], start
        while t < end:
            drift = 0.0002 * math.sin(len(out) / 15)
            ret = rng.gauss(drift, 0.0015)
            o = price
            c = price * (1 + ret)
            h = max(o, c) * (1 + abs(rng.gauss(0, 0.0005)))
            l = min(o, c) * (1 - abs(rng.gauss(0, 0.0005)))
            out.append(Bar(t, o, h, l, c, float(rng.randint(1_000, 50_000))))
            price = c
            t += timedelta(minutes=step)
        # Rescale so the series ends at the same price the mock quote reports.
        if out:
            k = self._price(symbol) / out[-1].close
            out = [Bar(b.ts, b.open * k, b.high * k, b.low * k, b.close * k, b.volume) for b in out]
        return out

    async def option_chain(self, underlying: str, expiry: date | None = None) -> OptionChain:
        s = self._price(underlying)
        now = self.now_fn() - self.age
        expiry = expiry or now.astimezone(NY).date()
        close = datetime.combine(expiry, datetime.min.time(), tzinfo=NY) + timedelta(hours=16)
        t = max((close - now).total_seconds() / (365 * 24 * 3600), 1 / (365 * 24 * 60))
        step = 5.0 if s > 1000 else 1.0
        atm = round(s / step) * step
        quotes = []
        for k in range(-10, 11):
            strike = atm + k * step
            iv = 0.16 + 0.002 * abs(k)
            for right in ("C", "P"):
                px = bs_price(s, strike, t, 0.04, iv, right)
                g = bs_greeks(s, strike, t, 0.04, iv, right)
                half = max(0.01, px * 0.02)
                sym = f"{underlying.upper()}{expiry:%y%m%d}{right}{int(strike * 1000):08d}"
                quotes.append(OptionQuote(sym, underlying.upper(), right, strike, expiry,
                                          round(max(px - half, 0.01), 2), round(px + half, 2),
                                          round(px, 2), 5000 - 300 * abs(k), 20000 - 1500 * abs(k),
                                          iv, g.delta, g.gamma, g.theta, g.vega, now, SOURCE, True))
        return OptionChain(underlying.upper(), s, quotes, now, SOURCE, True)

    async def economic_calendar(self, start: datetime, end: datetime) -> list[EconomicEvent]:
        return []
