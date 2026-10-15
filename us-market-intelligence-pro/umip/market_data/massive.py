"""Massive (formerly Polygon.io) REST adapter.

STATUS: written against the documented Polygon v2/v3 REST shapes but NOT tested
against the live API (no key in this environment). Endpoints, field names and
entitlements (real-time vs delayed, OPRA options) must be verified with the
account's plan before enabling. Redistribution to subscribers requires a
commercial agreement (see docs/DATA_SOURCES.md).
"""

from __future__ import annotations

from datetime import date, datetime

import httpx

from umip.market_data.base import (
    Bar, DataUnavailableError, EconomicEvent, OptionChain, OptionQuote, Quote,
)
from umip.timeutil import UTC

INDEX_TICKERS = {"SPX": "I:SPX", "NDX": "I:NDX", "RUT": "I:RUT", "VIX": "I:VIX", "DJI": "I:DJI"}
TF = {"1m": (1, "minute"), "5m": (5, "minute"), "15m": (15, "minute"), "1h": (1, "hour"),
      "1d": (1, "day")}


def _ns(ts: int | None) -> datetime:
    if not ts:
        raise DataUnavailableError("missing timestamp")
    return datetime.fromtimestamp(ts / 1e9, tz=UTC)


class MassiveProvider:
    name = "Massive"
    is_mock = False

    def __init__(self, api_key: str, base_url: str = "https://api.massive.com",
                 client: httpx.AsyncClient | None = None, delayed: bool = False):
        self._client = client or httpx.AsyncClient(base_url=base_url, timeout=10.0)
        self._key = api_key
        self.delayed = delayed

    async def _get(self, path: str, **params) -> dict:
        r = await self._client.get(path, params={**params, "apiKey": self._key})
        if r.status_code != 200:
            raise DataUnavailableError(f"{path}: HTTP {r.status_code}")
        return r.json()

    async def quote(self, symbol: str) -> Quote:
        s = symbol.upper()
        if s in INDEX_TICKERS:
            data = await self._get("/v3/snapshot", **{"ticker.any_of": INDEX_TICKERS[s]})
            res = (data.get("results") or [None])[0]
            if not res or "value" not in res:
                raise DataUnavailableError(f"no index snapshot for {s}")
            return Quote(s, float(res["value"]), None, None,
                         _ns(res.get("last_updated")), self.name, False, self.delayed)
        data = await self._get(f"/v2/snapshot/locale/us/markets/stocks/tickers/{s}")
        t = data.get("ticker") or {}
        last, q = t.get("lastTrade") or {}, t.get("lastQuote") or {}
        if not last:
            raise DataUnavailableError(f"no trade for {s}")
        return Quote(s, float(last["p"]), q.get("p"), q.get("P"), _ns(last.get("t")),
                     self.name, False, self.delayed)

    async def bars(self, symbol: str, timeframe: str, start: datetime, end: datetime) -> list[Bar]:
        mult, span = TF[timeframe]
        ticker = INDEX_TICKERS.get(symbol.upper(), symbol.upper())
        data = await self._get(
            f"/v2/aggs/ticker/{ticker}/range/{mult}/{span}/"
            f"{int(start.timestamp() * 1000)}/{int(end.timestamp() * 1000)}",
            adjusted="true", sort="asc", limit=50000)
        return [Bar(datetime.fromtimestamp(b["t"] / 1000, tz=UTC), b["o"], b["h"], b["l"], b["c"],
                    b.get("v", 0.0)) for b in data.get("results", [])]

    async def option_chain(self, underlying: str, expiry: date | None = None) -> OptionChain:
        params = {"limit": 250}
        if expiry:
            params["expiration_date"] = expiry.isoformat()
        data = await self._get(f"/v3/snapshot/options/{underlying.upper()}", **params)
        quotes, newest, spot = [], None, None
        for r in data.get("results", []):
            d, q, g = r.get("details", {}), r.get("last_quote", {}), r.get("greeks", {})
            if not q.get("bid") or not q.get("ask"):
                continue  # untradeable without a two-sided market
            ts = _ns(q.get("last_updated"))
            newest = max(newest, ts) if newest else ts
            spot = (r.get("underlying_asset") or {}).get("price", spot)
            quotes.append(OptionQuote(
                d["ticker"], underlying.upper(), "C" if d["contract_type"] == "call" else "P",
                float(d["strike_price"]), date.fromisoformat(d["expiration_date"]),
                float(q["bid"]), float(q["ask"]), (r.get("last_trade") or {}).get("price"),
                int((r.get("day") or {}).get("volume", 0)), int(r.get("open_interest", 0)),
                r.get("implied_volatility"), g.get("delta"), g.get("gamma"), g.get("theta"),
                g.get("vega"), ts, self.name))
        if not quotes or spot is None:
            raise DataUnavailableError(f"empty option chain for {underlying}")
        return OptionChain(underlying.upper(), float(spot), quotes, newest, self.name)

    async def economic_calendar(self, start: datetime, end: datetime) -> list[EconomicEvent]:
        # Massive does not provide a macro calendar; use a dedicated licensed source.
        raise DataUnavailableError("economic calendar source not configured")
