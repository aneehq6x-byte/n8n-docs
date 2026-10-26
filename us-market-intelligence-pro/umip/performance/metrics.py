"""Performance and business analytics.

Trading results are always grouped by ``ResultKind`` (backtest / paper /
published) and never merged. EXPIRED signals are reported separately and
excluded from win-rate. Outcome R-multiples come from the stored close event
data (``r_net``), so every figure can be recomputed from the event log.

Business metrics are computed from the ledger (money actually collected) and
subscription periods; nothing is estimated or projected.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from umip.models import (
    Coupon, LedgerEntry, Payment, PaymentStatus, ResultKind, Signal, SignalEvent,
    SignalStatus as S, Subscription, SubscriptionStatus, User,
)
from umip.timeutil import NY, ensure_utc

CLOSED = {S.TARGET2_HIT, S.STOPPED, S.CANCELLED}
ENTITLED = (SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED)


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


def _session_bucket(dt: datetime) -> str:
    t = ensure_utc(dt).astimezone(NY)
    minutes = t.hour * 60 + t.minute
    if minutes < 10 * 60 + 30:
        return "open"  # 09:30–10:30
    if minutes < 14 * 60:
        return "midday"
    return "close"  # 14:00–16:00


async def signal_performance(session: AsyncSession, kind: ResultKind) -> dict:
    sigs = list((await session.scalars(
        select(Signal).where(Signal.kind == kind).order_by(Signal.id))).all())
    closed: list[tuple[datetime, float, Signal]] = []
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
        closed.append((ensure_utc(sig.closed_at or ev.created_at), float(r), sig))
    closed.sort(key=lambda x: x[0])
    groups: dict[str, dict[str, list[float]]] = {
        "by_strategy": defaultdict(list), "by_symbol": defaultdict(list),
        "by_session": defaultdict(list)}
    curve, cum = [], 0.0
    for at, r, sig in closed:
        groups["by_strategy"][sig.strategy].append(r)
        groups["by_symbol"][sig.symbol].append(r)
        groups["by_session"][_session_bucket(sig.detected_at)].append(r)
        cum += r
        curve.append({"at": at.isoformat(), "ref": sig.ref, "r": round(r, 3), "cum_r": round(cum, 3)})
    return {"kind": kind.value, "status_counts": counts,
            "expired_not_counted": counts.get("expired", 0),
            "overall": summarize([r for _, r, _ in closed]),
            **{g: {k: summarize(v) for k, v in d.items()} for g, d in groups.items()},
            "equity_curve": curve,
            "note": "R after estimated spread/slippage/fees; EXPIRED excluded from win rate."}


def _days(now: datetime, n: int) -> list[date]:
    end = ensure_utc(now).date()
    return [end - timedelta(days=i) for i in range(n - 1, -1, -1)]


async def business_metrics(session: AsyncSession, now: datetime, window_days: int = 30) -> dict:
    now = ensure_utc(now)
    since = now - timedelta(days=window_days)
    ledger = list((await session.scalars(select(LedgerEntry))).all())
    revenue_all = sum(e.amount_minor for e in ledger)
    revenue_window = sum(e.amount_minor for e in ledger if ensure_utc(e.created_at) >= since)
    refunds_window = -sum(e.amount_minor for e in ledger
                          if e.kind == "refund" and ensure_utc(e.created_at) >= since)

    paid = list((await session.scalars(
        select(Payment).where(Payment.status.in_((PaymentStatus.PAID, PaymentStatus.REFUNDED))))).all())
    paying_users = {p.user_id for p in paid if p.status == PaymentStatus.PAID}
    payments_per_user: dict[int, int] = defaultdict(int)
    for p in paid:
        if p.status == PaymentStatus.PAID:
            payments_per_user[p.user_id] += 1
    # MRR only from genuinely recurring (30-day Stars) subscriptions paid in the window.
    mrr = sum(p.amount_minor for p in paid if p.is_recurring and p.status == PaymentStatus.PAID
              and p.paid_at and ensure_utc(p.paid_at) >= since)

    total_users = await session.scalar(select(func.count(User.id))) or 0
    subs = list((await session.scalars(select(Subscription))).all())
    by_user: dict[int, list[Subscription]] = defaultdict(list)
    for s in subs:
        by_user[s.user_id].append(s)

    def entitled_at(uid: int, t: datetime) -> bool:
        # EXPIRED rows still prove past entitlement; refunded periods never count.
        return any(s.status != SubscriptionStatus.REFUNDED
                   and ensure_utc(s.starts_at) <= t < ensure_utc(s.ends_at)
                   for s in by_user[uid])

    active_now = {u for u in by_user if entitled_at(u, now)}
    active_start = {u for u in by_user if entitled_at(u, since)}
    churned = active_start - active_now
    new_paid_users = {p.user_id for p in paid if p.paid_at and ensure_utc(p.paid_at) >= since
                      and payments_per_user[p.user_id] == 1}

    days = _days(now, window_days)
    rev_by_day: dict[date, int] = defaultdict(int)
    for e in ledger:
        rev_by_day[ensure_utc(e.created_at).date()] += e.amount_minor
    subs_by_day: dict[date, int] = defaultdict(int)
    for s in subs:
        if s.payment_id is not None:
            subs_by_day[ensure_utc(s.created_at).date()] += 1
    users_rows = (await session.scalars(select(User.created_at))).all()
    users_by_day: dict[date, int] = defaultdict(int)
    for c in users_rows:
        users_by_day[ensure_utc(c).date()] += 1
    active_by_day = [len({u for u in by_user if entitled_at(
        u, datetime.combine(d, datetime.max.time(), tzinfo=now.tzinfo))}) for d in days]

    coupons = [{"code": c.code, "percent_off": c.percent_off, "redemptions": c.redemptions,
                "max_redemptions": c.max_redemptions, "active": c.active,
                "revenue": sum(p.amount_minor for p in paid
                               if p.coupon_code == c.code and p.status == PaymentStatus.PAID)}
               for c in (await session.scalars(select(Coupon))).all()]

    return {
        "currency": "XTR", "window_days": window_days,
        "total_users": total_users, "active_subscribers": len(active_now),
        "revenue_window": revenue_window, "refunds_window": refunds_window,
        "revenue_all_time": revenue_all, "paying_users": len(paying_users),
        "new_paying_users_window": len(new_paid_users),
        "mrr_recurring_only": mrr,
        "arpu_all_time": round(revenue_all / len(paying_users), 1) if paying_users else None,
        "churn_rate_window": round(len(churned) / len(active_start), 4) if active_start else None,
        "churned_users_window": len(churned),
        "conversion_rate": round(len(paying_users) / total_users, 4) if total_users else None,
        "repeat_purchase_rate": (round(sum(1 for n in payments_per_user.values() if n >= 2)
                                       / len(payments_per_user), 4) if payments_per_user else None),
        "series": [{"date": d.isoformat(), "revenue": rev_by_day.get(d, 0),
                    "new_paid_subscriptions": subs_by_day.get(d, 0),
                    "new_users": users_by_day.get(d, 0), "active_subscribers": a}
                   for d, a in zip(days, active_by_day)],
        "coupons": coupons,
        "definitions": {
            "revenue": "Net Stars recorded in the ledger (charges minus refunds).",
            "churn_rate_window": "Users entitled at window start and not entitled now / users "
                                 "entitled at window start.",
            "conversion_rate": "Users with ≥1 paid payment / all registered users.",
            "mrr_recurring_only": "Sum of recurring 30-day Stars subscription charges in the window; "
                                  "fixed-term plans are excluded.",
        },
    }
