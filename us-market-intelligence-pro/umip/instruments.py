"""Static instrument specifications.

The point of this module is that SPX and SPY (and friends) are *not*
interchangeable: exercise style, settlement and contract size differ, and the
options engine and messages must respect that.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class AssetType(StrEnum):
    INDEX = "index"
    ETF = "etf"
    STOCK = "stock"
    VOL_INDEX = "vol_index"


class ExerciseStyle(StrEnum):
    AMERICAN = "american"
    EUROPEAN = "european"


class Settlement(StrEnum):
    PHYSICAL = "physical"  # delivers shares
    CASH = "cash"


@dataclass(frozen=True)
class InstrumentSpec:
    symbol: str
    asset_type: AssetType
    tradable_underlying: bool  # an index itself cannot be bought
    options_exercise: ExerciseStyle | None
    options_settlement: Settlement | None
    multiplier: int
    has_daily_expiries: bool
    notes: str
    correlation_group: str


SPECS: dict[str, InstrumentSpec] = {
    "SPX": InstrumentSpec(
        "SPX", AssetType.INDEX, False, ExerciseStyle.EUROPEAN, Settlement.CASH, 100, True,
        "Cboe index options. Standard monthly (3rd Friday) are AM-settled (SOQ); "
        "SPXW weeklies/dailies are PM-settled. European exercise, no early assignment. "
        "US tax: Section 1256 (verify with a tax advisor).",
        "us_large_cap",
    ),
    "SPY": InstrumentSpec(
        "SPY", AssetType.ETF, True, ExerciseStyle.AMERICAN, Settlement.PHYSICAL, 100, True,
        "ETF options: American exercise, early-assignment risk (notably around ex-dividend), "
        "physically settled in shares. Notional is ~1/10 of SPX.",
        "us_large_cap",
    ),
    "NDX": InstrumentSpec(
        "NDX", AssetType.INDEX, False, ExerciseStyle.EUROPEAN, Settlement.CASH, 100, True,
        "Nasdaq index options, European, cash-settled. Very large notional per contract.",
        "us_tech",
    ),
    "QQQ": InstrumentSpec(
        "QQQ", AssetType.ETF, True, ExerciseStyle.AMERICAN, Settlement.PHYSICAL, 100, True,
        "ETF options, American, physically settled.",
        "us_tech",
    ),
    "RUT": InstrumentSpec(
        "RUT", AssetType.INDEX, False, ExerciseStyle.EUROPEAN, Settlement.CASH, 100, False,
        "Russell 2000 index options, European, cash-settled.",
        "us_small_cap",
    ),
    "IWM": InstrumentSpec(
        "IWM", AssetType.ETF, True, ExerciseStyle.AMERICAN, Settlement.PHYSICAL, 100, True,
        "ETF options, American, physically settled.",
        "us_small_cap",
    ),
    "DIA": InstrumentSpec(
        "DIA", AssetType.ETF, True, ExerciseStyle.AMERICAN, Settlement.PHYSICAL, 100, False,
        "ETF options, American, physically settled.",
        "us_large_cap",
    ),
    "VIX": InstrumentSpec(
        "VIX", AssetType.VOL_INDEX, False, ExerciseStyle.EUROPEAN, Settlement.CASH, 100, False,
        "VIX options price off VIX futures, not spot VIX; expire on Wednesdays with "
        "special opening quotation (SOQ) settlement. Spot-VIX analysis does not transfer.",
        "volatility",
    ),
}


def get_spec(symbol: str) -> InstrumentSpec:
    """Known index/ETF spec, or a generic US equity spec for stocks."""
    s = symbol.upper()
    if s in SPECS:
        return SPECS[s]
    return InstrumentSpec(
        s, AssetType.STOCK, True, ExerciseStyle.AMERICAN, Settlement.PHYSICAL, 100, False,
        "US equity option: American exercise, physically settled.", f"stock:{s}",
    )
