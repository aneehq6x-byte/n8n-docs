"""Normalized market-data types and the provider contract.

Every value carries ``source`` and ``as_of`` so the UI can show where and when
it came from, and ``is_mock`` so test data can never be published as real.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Literal, Protocol

from umip.timeutil import ensure_utc, utcnow


class StaleDataError(RuntimeError):
    pass


class DataUnavailableError(RuntimeError):
    pass


@dataclass(frozen=True)
class Bar:
    ts: datetime  # bar open time, UTC
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass(frozen=True)
class Quote:
    symbol: str
    last: float
    bid: float | None
    ask: float | None
    as_of: datetime
    source: str
    is_mock: bool = False
    delayed: bool = False

    @property
    def mid(self) -> float:
        if self.bid and self.ask:
            return (self.bid + self.ask) / 2
        return self.last


@dataclass(frozen=True)
class OptionQuote:
    contract: str  # OCC symbol
    underlying: str
    right: Literal["C", "P"]
    strike: float
    expiry: date
    bid: float
    ask: float
    last: float | None
    volume: int
    open_interest: int
    iv: float | None
    delta: float | None
    gamma: float | None
    theta: float | None
    vega: float | None
    as_of: datetime
    source: str
    is_mock: bool = False

    @property
    def mid(self) -> float:
        return (self.bid + self.ask) / 2

    @property
    def spread(self) -> float:
        return self.ask - self.bid

    @property
    def spread_pct(self) -> float:
        return self.spread / self.mid if self.mid > 0 else float("inf")


@dataclass(frozen=True)
class OptionChain:
    underlying: str
    underlying_price: float
    quotes: list[OptionQuote]
    as_of: datetime
    source: str
    is_mock: bool = False


@dataclass(frozen=True)
class EconomicEvent:
    name: str  # e.g. CPI, FOMC, NFP
    at: datetime
    importance: Literal["low", "medium", "high"]
    source: str


@dataclass
class Freshness:
    max_age: timedelta
    now_fn: callable = field(default=utcnow)

    def check(self, as_of: datetime, what: str) -> None:
        age = self.now_fn() - ensure_utc(as_of)
        if age > self.max_age:
            raise StaleDataError(f"{what} is stale: {age.total_seconds():.0f}s old "
                                 f"(max {self.max_age.total_seconds():.0f}s)")


class MarketDataProvider(Protocol):
    name: str
    is_mock: bool

    async def quote(self, symbol: str) -> Quote: ...
    async def bars(self, symbol: str, timeframe: str, start: datetime, end: datetime) -> list[Bar]: ...
    async def option_chain(self, underlying: str, expiry: date | None = None) -> OptionChain: ...
    async def economic_calendar(self, start: datetime, end: datetime) -> list[EconomicEvent]: ...
