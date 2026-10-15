"""Telegram Stars payments.

Flow (Bot API):
1. ``create_invoice`` stores a PENDING payment with a random nonce and returns a
   signed payload for sendInvoice / createInvoiceLink (currency ``XTR``, empty
   provider_token).
2. ``validate_pre_checkout`` runs on pre_checkout_query (must be answered within
   10s): payload signature, pending payment, matching user/amount/currency.
3. ``process_successful_payment`` runs on the successful_payment *service
   message*, which is the server-side confirmation. It is idempotent on
   ``telegram_payment_charge_id`` so retries/redeliveries never double-grant.
   Nothing is ever activated from screenshots or user claims.
4. ``refund`` calls refundStarPayment through a gateway, then records it.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from umip.audit import audit
from umip.models import (
    LedgerEntry, Payment, PaymentStatus, Plan, Subscription, SubscriptionStatus, User,
)
from umip.subscriptions.service import apply_coupon, grant_period
from umip.timeutil import utcnow

STARS = "XTR"
PROVIDER = "telegram_stars"
STARS_SUBSCRIPTION_PERIOD = 2592000  # 30 days: the only period Telegram allows
STARS_SUBSCRIPTION_MAX = 10000  # max Stars per subscription period (verify on launch)


class PaymentError(ValueError):
    pass


def sign_payload(key: str, nonce: str) -> str:
    mac = hmac.new(key.encode(), nonce.encode(), hashlib.sha256).hexdigest()[:32]
    return f"v1:{nonce}:{mac}"


def verify_payload(key: str, payload: str) -> str:
    try:
        version, nonce, mac = payload.split(":")
    except ValueError as e:
        raise PaymentError("malformed payload") from e
    if version != "v1":
        raise PaymentError("unknown payload version")
    expected = sign_payload(key, nonce).split(":")[2]
    if not hmac.compare_digest(mac, expected):
        raise PaymentError("bad payload signature")
    return nonce


@dataclass
class Invoice:
    payment_id: int
    payload: str
    title: str
    description: str
    currency: str
    amount: int
    subscription_period: int | None


async def create_invoice(session: AsyncSession, signing_key: str, user: User, plan: Plan,
                         coupon_code: str | None = None, lang: str = "ar") -> Invoice:
    if plan.is_trial or plan.price_stars <= 0:
        raise PaymentError("trial plans are not sold")
    amount, coupon = await apply_coupon(session, plan, coupon_code)
    # Recurring Stars subscriptions: 30-day period only, no coupon (renewals re-charge full price).
    recurring = plan.recurring and coupon is None and plan.duration_days == 30
    if recurring and amount > STARS_SUBSCRIPTION_MAX:
        recurring = False
    nonce = secrets.token_hex(12)
    p = Payment(user_id=user.id, plan_id=plan.id, provider=PROVIDER, currency=STARS,
                amount_minor=amount, nonce=nonce, coupon_code=coupon.code if coupon else None,
                is_recurring=recurring)
    session.add(p)
    await session.flush()
    await audit(session, f"user:{user.id}", "payment.invoice_created", f"payment:{p.id}",
                plan=plan.code, amount=amount, coupon=p.coupon_code)
    await session.commit()
    title = plan.name_ar if lang == "ar" else plan.name_en
    desc = ("وصول إلى التحليلات والإشارات الخاصة لمدة {} يومًا" if lang == "ar"
            else "Access to private analysis and signals for {} days").format(plan.duration_days)
    return Invoice(p.id, sign_payload(signing_key, nonce), title, desc, STARS, amount,
                   STARS_SUBSCRIPTION_PERIOD if recurring else None)


async def _payment_by_payload(session: AsyncSession, signing_key: str, payload: str) -> Payment:
    nonce = verify_payload(signing_key, payload)
    p = await session.scalar(select(Payment).where(Payment.nonce == nonce))
    if p is None:
        raise PaymentError("unknown invoice")
    return p


async def validate_pre_checkout(session: AsyncSession, signing_key: str, telegram_user_id: int,
                                payload: str, currency: str, total_amount: int) -> Payment:
    """Raise PaymentError (answer ok=False) unless the checkout is exactly what we issued."""
    p = await _payment_by_payload(session, signing_key, payload)
    user = await session.get(User, p.user_id)
    if user is None or user.telegram_id != telegram_user_id:
        raise PaymentError("invoice belongs to another user")
    if user.is_blocked:
        raise PaymentError("user blocked")
    if p.status != PaymentStatus.PENDING:
        raise PaymentError("invoice already used")
    if currency != p.currency or total_amount != p.amount_minor:
        raise PaymentError("amount mismatch")
    plan = await session.get(Plan, p.plan_id)
    if plan is None or not plan.active:
        raise PaymentError("plan no longer available")
    return p


@dataclass
class PaymentResult:
    payment: Payment
    newly_processed: bool
    ends_at: datetime | None


async def process_successful_payment(
    session: AsyncSession, signing_key: str, telegram_user_id: int, payload: str,
    currency: str, total_amount: int, telegram_payment_charge_id: str,
    is_recurring: bool = False, is_first_recurring: bool = False, raw: dict | None = None,
    now: datetime | None = None,
) -> PaymentResult:
    now = now or utcnow()
    # Idempotency: the same charge id is processed once.
    existing = await session.scalar(select(Payment).where(
        Payment.provider == PROVIDER, Payment.provider_charge_id == telegram_payment_charge_id))
    if existing is not None:
        return PaymentResult(existing, False, None)

    p = await _payment_by_payload(session, signing_key, payload)
    user = await session.get(User, p.user_id)
    if user is None or user.telegram_id != telegram_user_id:
        raise PaymentError("payer mismatch")
    if currency != p.currency or total_amount != p.amount_minor:
        await audit(session, "system", "payment.amount_mismatch", f"payment:{p.id}",
                    currency=currency, total=total_amount)
        await session.commit()
        raise PaymentError("amount mismatch")

    if p.status != PaymentStatus.PENDING:
        # A recurring renewal reuses the original invoice payload: new Payment row per charge.
        if not (is_recurring and not is_first_recurring):
            raise PaymentError("invoice already paid")
        p = Payment(user_id=p.user_id, plan_id=p.plan_id, provider=PROVIDER, currency=currency,
                    amount_minor=total_amount, nonce=secrets.token_hex(12), is_recurring=True)
        session.add(p)

    p.status = PaymentStatus.PAID
    p.provider_charge_id = telegram_payment_charge_id
    p.paid_at = now
    p.raw = raw
    try:
        await session.flush()
    except IntegrityError:
        # Concurrent duplicate delivery won the race.
        await session.rollback()
        dup = await session.scalar(select(Payment).where(
            Payment.provider == PROVIDER, Payment.provider_charge_id == telegram_payment_charge_id))
        return PaymentResult(dup, False, None)

    session.add(LedgerEntry(payment_id=p.id, kind="charge", currency=currency,
                            amount_minor=total_amount))
    if p.coupon_code:
        from umip.models import Coupon
        c = await session.scalar(select(Coupon).where(Coupon.code == p.coupon_code))
        if c:
            c.redemptions += 1
    plan = await session.get(Plan, p.plan_id)
    grant = await grant_period(session, user, plan, p, "payments", now, auto_renew=is_recurring)
    await audit(session, "payments", "payment.paid", f"payment:{p.id}",
                charge_id=telegram_payment_charge_id, amount=total_amount)
    await session.commit()
    return PaymentResult(p, True, grant.ends_at)


class StarsGateway(Protocol):
    async def refund_star_payment(self, user_id: int, telegram_payment_charge_id: str) -> bool: ...
    async def edit_user_star_subscription(self, user_id: int, telegram_payment_charge_id: str,
                                          is_canceled: bool) -> bool: ...


async def refund(session: AsyncSession, gateway: StarsGateway, payment_id: int, actor: str,
                 now: datetime | None = None) -> Payment:
    """Refund via Telegram first; only record it after Telegram confirms."""
    now = now or utcnow()
    p = await session.get(Payment, payment_id)
    if p is None or p.status != PaymentStatus.PAID:
        raise PaymentError("payment not refundable")
    user = await session.get(User, p.user_id)
    ok = await gateway.refund_star_payment(user.telegram_id, p.provider_charge_id)
    if not ok:
        raise PaymentError("telegram refused the refund")
    p.status = PaymentStatus.REFUNDED
    p.refunded_at = now
    session.add(LedgerEntry(payment_id=p.id, kind="refund", currency=p.currency,
                            amount_minor=-p.amount_minor))
    sub = await session.scalar(select(Subscription).where(Subscription.payment_id == p.id))
    if sub:
        sub.status = SubscriptionStatus.REFUNDED
    await audit(session, actor, "payment.refunded", f"payment:{p.id}")
    await session.commit()
    return p


async def cancel_auto_renew(session: AsyncSession, gateway: StarsGateway, user: User,
                            actor: str) -> int:
    """Turn off renewal; access continues until the paid period ends."""
    q = select(Subscription).where(Subscription.user_id == user.id,
                                   Subscription.auto_renew.is_(True),
                                   Subscription.status == SubscriptionStatus.ACTIVE)
    n = 0
    for sub in (await session.scalars(q)).all():
        p = await session.get(Payment, sub.payment_id) if sub.payment_id else None
        if p and p.provider_charge_id:
            await gateway.edit_user_star_subscription(user.telegram_id, p.provider_charge_id, True)
        sub.auto_renew = False
        sub.status = SubscriptionStatus.CANCELLED
        n += 1
    await audit(session, actor, "subscription.auto_renew_off", f"user:{user.id}", count=n)
    await session.commit()
    return n
