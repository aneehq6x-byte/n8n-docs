"""Automatic tracking of open signals against market bars.

Rules (identical in spirit to ``quant.backtest.simulate`` so live and historical
results are comparable):

- Only closed 1-minute bars after publication are used; never a bar's future.
- PUBLISHED → ACTIVE when a bar trades inside the entry zone before ``valid_until``.
  The fill is the bar open clamped into the zone. Unfilled signals are left for
  ``expire_due`` (EXPIRED: neither win nor loss).
- If the stop and a target are both inside one bar, the STOP is assumed first.
- After Target 1 the working stop moves to the entry (breakeven). The position is
  tracked as one unit; Target 2 or the working stop closes it.
- Intraday signals still open ``flatten_minutes`` before the session close are
  closed at the last bar (CANCELLED, note "session close") with their net R.
- Net R includes slippage and fees in bps on both sides.
- Stale or missing bars: nothing changes and the feed is marked unhealthy.

For option signals the R is measured on the underlying (the plan's levels); the
option premium path is not modelled here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from umip.market_data.base import Bar, DataUnavailableError, MarketDataProvider
from umip.market_data.health import FeedHealth
from umip.models import ResultKind, Signal, SignalStatus as S
from umip.signals import service as sigsvc
from umip.signals.formatting import render_update
from umip.timeutil import NY, ensure_utc, is_regular_session, session_close, utcnow

ACTOR = "tracker"


@dataclass(frozen=True)
class TrackerPolicy:
    slippage_bps: float = 2.0
    fee_bps: float = 0.5
    breakeven_after_t1: bool = True
    flatten_minutes: int = 5
    max_bar_lag: timedelta = timedelta(minutes=3)
    timeframe: str = "1m"
    bar_minutes: int = 1


@dataclass
class TrackResult:
    ref: str
    actions: list[str] = field(default_factory=list)
    skipped: str | None = None


def _adj(price: float, side: int, p: TrackerPolicy) -> float:
    return price * (1 + side * (p.slippage_bps + p.fee_bps) / 1e4)


def net_r(direction: str, entry: float, exit_: float, risk: float, p: TrackerPolicy) -> float:
    sign = 1 if direction == "long" else -1
    e, x = _adj(entry, sign, p), _adj(exit_, -sign, p)
    return round(sign * (x - e) / risk, 3) if risk > 0 else 0.0


def _initial_state(sig: Signal) -> dict:
    o = sig.original
    return {"entry": None, "entry_at": None, "stop": o["stop"], "mae_r": 0.0, "mfe_r": 0.0,
            "last_bar": None, "last_price": None, "updated_at": None}


async def _move(session: AsyncSession, sig: Signal, to: S, note: str | None, data: dict | None,
                chat_id: int | None, at: datetime) -> None:
    """State change + (for subscriber signals) an outbox update with a dedup key."""
    if sig.kind == ResultKind.PUBLISHED and chat_id is not None:
        await sigsvc.update_status(session, sig, to, ACTOR, chat_id, render_update, note, data)
    else:
        await sigsvc._transition(session, sig, to, ACTOR, note, data)
    if to in sigsvc.TERMINAL:
        sig.closed_at = at


def _flatten_at(sig: Signal, state: dict, p: TrackerPolicy) -> datetime | None:
    """Session-close deadline for the entry day of an intraday signal."""
    if not state.get("entry_at"):
        return None
    day = datetime.fromisoformat(state["entry_at"]).astimezone(NY).date()
    close = datetime.combine(day, session_close(day), tzinfo=NY)
    return close - timedelta(minutes=p.flatten_minutes)


async def track_signal(session: AsyncSession, sig: Signal, bars: list[Bar], now: datetime,
                       p: TrackerPolicy, chat_id: int | None) -> list[str]:
    o = sig.original
    state = dict(sig.tracking or _initial_state(sig))
    long = sig.direction == "long"
    el, eh, t1, t2 = o["entry_low"], o["entry_high"], o["target1"], o["target2"]
    risk = abs((el + eh) / 2 - o["stop"])
    last_bar = datetime.fromisoformat(state["last_bar"]) if state.get("last_bar") else None
    actions: list[str] = []

    for b in bars:
        bt = ensure_utc(b.ts)
        if last_bar is not None and bt <= last_bar:
            continue  # already processed: re-runs are idempotent
        if bt + timedelta(minutes=p.bar_minutes) > now:
            break  # bar not closed yet
        state["last_bar"], state["last_price"] = bt.isoformat(), b.close
        last_bar = bt

        if sig.status == S.PUBLISHED:
            if bt >= ensure_utc(sig.valid_until):
                break
            if b.low <= eh and b.high >= el:
                fill = min(max(b.open, el), eh)
                state["entry"], state["entry_at"] = fill, bt.isoformat()
                await _move(session, sig, S.ACTIVE, f"entry filled at {fill:.2f}",
                            {"entry_fill": fill}, chat_id, bt)
                actions.append("active")
            else:
                continue

        if sig.status not in (S.ACTIVE, S.TARGET1_HIT):
            break
        entry = state["entry"]
        adverse = (entry - b.low) if long else (b.high - entry)
        favorable = (b.high - entry) if long else (entry - b.low)
        state["mae_r"] = round(max(state["mae_r"], adverse / risk), 3)
        state["mfe_r"] = round(max(state["mfe_r"], favorable / risk), 3)
        stop = state["stop"]
        hit_stop = b.low <= stop if long else b.high >= stop
        hit_t2 = b.high >= t2 if long else b.low <= t2
        hit_t1 = b.high >= t1 if long else b.low <= t1

        if hit_stop:  # conservative: stop first
            r = net_r(sig.direction, entry, stop, risk, p)
            note = "breakeven stop after target 1" if sig.status == S.TARGET1_HIT else f"stop hit at {stop:.2f}"
            await _move(session, sig, S.STOPPED, note, _close_data(state, stop, r), chat_id, bt)
            actions.append("stopped")
            break
        if hit_t2:
            r = net_r(sig.direction, entry, t2, risk, p)
            await _move(session, sig, S.TARGET2_HIT, f"target 2 at {t2:.2f}", _close_data(state, t2, r),
                        chat_id, bt)
            actions.append("target2_hit")
            break
        if hit_t1 and sig.status == S.ACTIVE:
            await _move(session, sig, S.TARGET1_HIT, f"target 1 at {t1:.2f}",
                        {"r_unrealized": net_r(sig.direction, entry, t1, risk, p)}, chat_id, bt)
            if p.breakeven_after_t1:
                state["stop"] = entry
            actions.append("target1_hit")

        deadline = _flatten_at(sig, state, p)
        if deadline and bt + timedelta(minutes=p.bar_minutes) >= deadline:
            r = net_r(sig.direction, entry, b.close, risk, p)
            await _move(session, sig, S.CANCELLED, "closed at session end", _close_data(state, b.close, r),
                        chat_id, bt)
            actions.append("session_close")
            break

    state["updated_at"] = ensure_utc(now).isoformat()
    sig.tracking = state  # reassign so the JSON column is flagged dirty
    await session.commit()
    return actions


def _close_data(state: dict, exit_: float, r: float) -> dict:
    return {"r_net": r, "exit": exit_, "entry_fill": state["entry"], "mae_r": state["mae_r"],
            "mfe_r": state["mfe_r"]}


async def track_open_signals(session: AsyncSession, provider: MarketDataProvider, health: FeedHealth,
                             chat_id: int | None, policy: TrackerPolicy = TrackerPolicy(),
                             now: datetime | None = None) -> list[TrackResult]:
    """One tracking pass over every open signal. Safe to run repeatedly."""
    now = ensure_utc(now or utcnow())
    q = select(Signal).where(Signal.status.in_(sigsvc.OPEN_STATES)).order_by(Signal.id)
    results: list[TrackResult] = []
    for sig in (await session.scalars(q)).all():
        res = TrackResult(sig.ref)
        results.append(res)
        # Mock prices never decide a real signal, and real prices never track mock levels.
        if sig.is_mock_data != provider.is_mock:
            res.skipped = "data source does not match the signal's data source"
            continue
        start = ensure_utc(sig.published_at or sig.detected_at)
        if sig.tracking and sig.tracking.get("last_bar"):
            start = datetime.fromisoformat(sig.tracking["last_bar"])
        try:
            bars = await provider.bars(sig.symbol, policy.timeframe, start, now)
        except DataUnavailableError as e:
            health.fail(provider.name)
            res.skipped = f"data unavailable: {e}"
            continue
        closed = [b for b in bars if ensure_utc(b.ts) + timedelta(minutes=policy.bar_minutes) <= now]
        if closed and now - (ensure_utc(closed[-1].ts) + timedelta(minutes=policy.bar_minutes)) > policy.max_bar_lag \
                and is_regular_session(now):
            health.fail(provider.name)
            res.skipped = "stale bars"
            continue
        health.ok(provider.name, now)
        res.actions = await track_signal(session, sig, closed, now, policy, chat_id)
    return results

