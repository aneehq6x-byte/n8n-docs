"""Time helpers. Everything is stored in UTC; display in New York and Riyadh.

DST is handled by the IANA tz database (zoneinfo), never by fixed offsets.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")
RIYADH = ZoneInfo("Asia/Riyadh")
UTC = timezone.utc

RTH_OPEN = time(9, 30)
RTH_CLOSE = time(16, 0)
PREMARKET_OPEN = time(4, 0)

# NYSE full-day holidays. Must be refreshed yearly from the official NYSE calendar.
NYSE_HOLIDAYS: frozenset[date] = frozenset(
    {
        date(2026, 1, 1), date(2026, 1, 19), date(2026, 2, 16), date(2026, 4, 3),
        date(2026, 5, 25), date(2026, 6, 19), date(2026, 7, 3), date(2026, 9, 7),
        date(2026, 11, 26), date(2026, 12, 25),
        date(2027, 1, 1), date(2027, 1, 18), date(2027, 2, 15), date(2027, 3, 26),
        date(2027, 5, 31), date(2027, 6, 18), date(2027, 7, 5), date(2027, 9, 6),
        date(2027, 11, 25), date(2027, 12, 24),
    }
)
# Early closes at 13:00 ET.
NYSE_EARLY_CLOSES: frozenset[date] = frozenset(
    {date(2026, 11, 27), date(2026, 12, 24), date(2027, 11, 26)}
)


def utcnow() -> datetime:
    return datetime.now(UTC)


def ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        # Naive datetimes coming back from SQLite are stored as UTC.
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def is_trading_day(d: date) -> bool:
    return d.weekday() < 5 and d not in NYSE_HOLIDAYS


def session_close(d: date) -> time:
    return time(13, 0) if d in NYSE_EARLY_CLOSES else RTH_CLOSE


def is_regular_session(dt: datetime) -> bool:
    local = ensure_utc(dt).astimezone(NY)
    if not is_trading_day(local.date()):
        return False
    return RTH_OPEN <= local.time() < session_close(local.date())


def minutes_to_close(dt: datetime) -> float:
    local = ensure_utc(dt).astimezone(NY)
    close = datetime.combine(local.date(), session_close(local.date()), tzinfo=NY)
    return (close - local).total_seconds() / 60


def minutes_since_open(dt: datetime) -> float:
    local = ensure_utc(dt).astimezone(NY)
    open_ = datetime.combine(local.date(), RTH_OPEN, tzinfo=NY)
    return (local - open_).total_seconds() / 60


def format_dual(dt: datetime) -> str:
    """'2026-03-09 10:05 ET | 17:05 Riyadh' (ET label follows DST)."""
    u = ensure_utc(dt)
    ny = u.astimezone(NY)
    ry = u.astimezone(RIYADH)
    return f"{ny:%Y-%m-%d %H:%M} {ny.tzname()} | {ry:%H:%M} Riyadh"


def next_trading_day(d: date) -> date:
    n = d + timedelta(days=1)
    while not is_trading_day(n):
        n += timedelta(days=1)
    return n
