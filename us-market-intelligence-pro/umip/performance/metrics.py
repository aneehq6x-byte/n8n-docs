"""Performance and business analytics.

Trading results are always grouped by ``ResultKind`` (backtest / paper /
published) and never merged. EXPIRED signals are reported separately and
excluded from win-rate. Outcome R-multiples come from the stored
``close`` event data, so every figure can be recomputed from the event log.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from umip.models import (
    LedgerEntry, Payment, PaymentStatus, ResultKind, Signal, SignalEvent, SignalStatus as S,
    Subscription,
)

CLOSED = {S.TARGET2_HIT, S.STOPPED, S.CANCELLED}


def summarize(r: list[float]) -> dict:
    wins = [x for x in r if x > 0]
    losses = [x for x in r if x <= 0]
    gp, gl = sum(wins), -sum(losses)
    eq = peak = dd = 0.0
    for x in r:
        eq += x
        peak = max(peak, eq)
        dd = max(dd, peak - eq)
    n = len(r)
    return {"trades": n, "win_rate": round(len(wins) / n, 4) if n else None,
            "avg_win_r": round(gp / len(wins), 3) if wins else None,
            "avg_loss_r": round(-gl / len(losses), 3) if losses else None,
            "profit_factor": round(gp / gl, 3) if gl else None,
            "expectancy_r": round((gp - gl) / n, 3) if n else None,
            "max_drawdown_r": round(dd, 3), "total_r": round(gp - gl, 3)}


async def signal_performance(session: AsyncSession, kind: ResultKind) -> dict:
    sigs = list((await session.scalars(select(Signal).where(Signal.kind == kind))).all())
    closed_r: list[float] = []
    by_strategy: dict[str, list[float]] = {}
    by_symbol: dict[str, list[float]] = {}
    counts: dict[str, int] = {}
    for sig in sigs:
        counts[sig.status.value] = counts.get(sig.status.value, 0) + 1
        if sig.status not in CLOSED:
            continue
        ev = await session.scalar(select(SignalEvent).where(
            SignalEvent.signal_id == sig.id, SignalEvent.to_status == sig.status.value)
            .order_by(SignalEvent.id.desc()))
        r = (ev.data or {}).get("r_net") if ev else None
        if r is None:
            continue  # never fabricate an outcome
        closed_r.append(r)
        by_strategy.setdefault(sig.strategy, []).append(r)
        by_symbol.setdefault(sig.symbol, []).append(r)
    return {"kind": kind.value, "status_counts": counts,
            "expired_not_counted": counts.get("expired", 0),
            "overall": summarize(closed_r),
            "by_strategy": {k: summarize(v) for k, v in by_strategy.items()},
            "by_symbol": {k: summarize(v) for k, v in by_symbol.items()},
            "note": "R after estimated spread/slippage/fees; EXPIRED excluded from win rate."}


async def business_metrics(session: AsyncSession, now: datetime) -> dict:
    since = now - timedelta(days=30)
    revenue_30d = await session.scalar(select(func.coalesce(func.sum(LedgerEntry.amount_minor), 0))
                                       .where(LedgerEntry.created_at >= since)) or 0
    revenue_all = await session.scalar(select(func.coalesce(func.sum(LedgerEntry.amount_minor), 0))) or 0
    paying = await session.scalar(select(func.count(func.distinct(Payment.user_id))).where(
        Payment.status == PaymentStatus.PAID)) or 0
    # MRR only from genuinely recurring (30-day Stars) subscriptions.
    mrr = await session.scalar(select(func.coalesce(func.sum(Payment.amount_minor), 0)).where(
        Payment.is_recurring.is_(True), Payment.status == PaymentStatus.PAID,
        Payment.paid_at >= since)) or 0
    ended = await session.scalar(select(func.count(func.distinct(Subscription.user_id))).where(
        Subscription.ends_at >= since, Subscription.ends_at < now)) or 0
    renewed = await session.scalar(select(func.count(func.distinct(Subscription.user_id))).where(
        Subscription.starts_at >= since, Subscription.payment_id.is_not(None))) or 0
    return {"currency": "XTR", "revenue_30d": revenue_30d, "revenue_all_time": revenue_all,
            "paying_users": paying, "mrr_recurring_only": mrr,
            "arpu_all_time": round(revenue_all / paying, 1) if paying else None,
            "periods_ended_30d": ended, "paid_starts_30d": renewed}
