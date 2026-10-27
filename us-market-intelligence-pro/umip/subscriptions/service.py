"""Plans, coupons, entitlements.

Entitlement = the user has an ACTIVE/CANCELLED subscription row whose window
covers "now". Renewing stacks a new period after the current end, so the user
never loses paid days and keeps the same account.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from umip.audit import audit
from umip.models import (
    Coupon, Payment, Plan, Subscription, SubscriptionStatus, TrialUsage, User,
)
from umip.timeutil import ensure_utc, utcnow

ENTITLED = (SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED)

DEFAULT_PLANS = [
    # code, ar, en, days, stars, recurring, trial
    ("monthly", "اشتراك شهري", "Monthly", 30, 1500, True, False),
    ("quarterly", "اشتراك 3 أشهر", "3 months", 90, 4000, False, False),
    ("semiannual", "اشتراك 6 أشهر", "6 months", 180, 7500, False, False),
    ("annual", "اشتراك سنوي", "Annual", 365, 14000, False, False),
    ("trial", "فترة تجربة", "Trial", 3, 0, False, True),
]


class CouponError(ValueError):
    pass


async def seed_default_plans(session: AsyncSession) -> None:
    """Placeholder prices in Stars; the admin must set real prices before launch."""
    existing = {p.code for p in (await session.scalars(select(Plan))).all()}
    for code, ar, en, days, stars, recurring, trial in DEFAULT_PLANS:
        if code not in existing:
            session.add(Plan(code=code, name_ar=ar, name_en=en, duration_days=days,
                             price_stars=stars, recurring=recurring, is_trial=trial))
    await session.commit()


async def list_plans(session: AsyncSession, include_trial: bool = True) -> list[Plan]:
    q = select(Plan).where(Plan.active.is_(True)).order_by(Plan.duration_days)
    plans = list((await session.scalars(q)).all())
    return [p for p in plans if include_trial or not p.is_trial]


async def get_plan(session: AsyncSession, code: str) -> Plan | None:
    return await session.scalar(select(Plan).where(Plan.code == code, Plan.active.is_(True)))


async def apply_coupon(session: AsyncSession, plan: Plan, code: str | None,
                       now: datetime | None = None) -> tuple[int, Coupon | None]:
    """Return (final_price, coupon). Does not consume the coupon."""
    if not code:
        return plan.price_stars, None
    now = now or utcnow()
    c = await session.scalar(select(Coupon).where(Coupon.code == code.upper()))
    if c is None or not c.active:
        raise CouponError("invalid coupon")
    if c.valid_until and ensure_utc(c.valid_until) < now:
        raise CouponError("coupon expired")
    if c.max_redemptions is not None and c.redemptions >= c.max_redemptions:
        raise CouponError("coupon exhausted")
    if c.plan_codes and plan.code not in c.plan_codes:
        raise CouponError("coupon not valid for this plan")
    if not 0 < c.percent_off < 100:
        raise CouponError("coupon misconfigured")
    price = max(1, round(plan.price_stars * (100 - c.percent_off) / 100))
    return price, c


async def current_subscription(session: AsyncSession, user_id: int,
                               now: datetime | None = None) -> Subscription | None:
    now = now or utcnow()
    q = (
        select(Subscription)
        .where(Subscription.user_id == user_id, Subscription.status.in_(ENTITLED))
        .order_by(Subscription.ends_at.desc())
    )
    for sub in (await session.scalars(q)).all():
        if ensure_utc(sub.starts_at) <= now < ensure_utc(sub.ends_at):
            return sub
    return None


async def entitlement_end(session: AsyncSession, user_id: int,
                          now: datetime | None = None) -> datetime | None:
    """Latest end among current and queued (future) periods."""
    now = now or utcnow()
    q = select(Subscription).where(Subscription.user_id == user_id,
                                   Subscription.status.in_(ENTITLED))
    ends = [ensure_utc(s.ends_at) for s in (await session.scalars(q)).all()
            if ensure_utc(s.ends_at) > now]
    return max(ends) if ends else None


async def is_entitled(session: AsyncSession, user_id: int, now: datetime | None = None) -> bool:
    return await current_subscription(session, user_id, now) is not None


@dataclass
class Grant:
    subscription: Subscription
    starts_at: datetime
    ends_at: datetime


async def grant_period(session: AsyncSession, user: User, plan: Plan,
                       payment: Payment | None, actor: str,
                       now: datetime | None = None, auto_renew: bool = False) -> Grant:
    """Add an access period stacked after any existing entitlement."""
    now = now or utcnow()
    start = await entitlement_end(session, user.id, now) or now
    end = start + timedelta(days=plan.duration_days)
    sub = Subscription(user_id=user.id, plan_id=plan.id,
                       payment_id=payment.id if payment else None,
                       starts_at=start, ends_at=end, status=SubscriptionStatus.ACTIVE,
                       auto_renew=auto_renew, created_at=now)
    session.add(sub)
    await session.flush()
    await audit(session, actor, "subscription.granted", f"user:{user.id}",
                plan=plan.code, starts_at=start.isoformat(), ends_at=end.isoformat(),
                payment_id=payment.id if payment else None)
    return Grant(sub, start, end)


async def start_trial(session: AsyncSession, user: User, now: datetime | None = None) -> Grant:
    """One trial per Telegram account, ever."""
    if await session.get(TrialUsage, user.id):
        raise ValueError("trial already used")
    plan = await session.scalar(select(Plan).where(Plan.is_trial.is_(True), Plan.active.is_(True)))
    if plan is None:
        raise ValueError("no trial plan configured")
    session.add(TrialUsage(user_id=user.id))
    grant = await grant_period(session, user, plan, None, f"user:{user.id}", now)
    await session.commit()
    return grant


async def expire_due(session: AsyncSession, now: datetime | None = None) -> list[Subscription]:
    """Mark ended periods EXPIRED. Returns the rows changed (idempotent)."""
    now = now or utcnow()
    q = select(Subscription).where(Subscription.status.in_(ENTITLED))
    expired = []
    for sub in (await session.scalars(q)).all():
        if ensure_utc(sub.ends_at) <= now:
            sub.status = SubscriptionStatus.EXPIRED
            expired.append(sub)
            await audit(session, "system", "subscription.expired", f"user:{sub.user_id}",
                        subscription_id=sub.id)
    await session.commit()
    return expired


async def users_needing_reminder(session: AsyncSession, days_before: int,
                                 now: datetime | None = None) -> list[int]:
    """Users whose entitlement ends within (days_before-1, days_before] days."""
    now = now or utcnow()
    q = select(Subscription.user_id).where(Subscription.status.in_(ENTITLED)).distinct()
    out = []
    for uid in (await session.scalars(q)).all():
        end = await entitlement_end(session, uid, now)
        if end and timedelta(days=days_before - 1) < end - now <= timedelta(days=days_before):
            out.append(uid)
    return out
