from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import func, select

from tests.conftest import SIGNING_KEY
from umip.models import (
    Coupon, LedgerEntry, Payment, PaymentStatus, Subscription, SubscriptionStatus,
)
from umip.payments import service as pay
from umip.subscriptions import service as subs
from umip.timeutil import utcnow


async def _buy(session, user, code="quarterly", charge="ch_1", coupon=None):
    plan = await subs.get_plan(session, code)
    inv = await pay.create_invoice(session, SIGNING_KEY, user, plan, coupon)
    await pay.validate_pre_checkout(session, SIGNING_KEY, user.telegram_id, inv.payload,
                                    inv.currency, inv.amount)
    res = await pay.process_successful_payment(session, SIGNING_KEY, user.telegram_id, inv.payload,
                                               inv.currency, inv.amount, charge)
    return inv, res


async def test_full_purchase_activates_subscription(session, user):
    assert not await subs.is_entitled(session, user.id)
    inv, res = await _buy(session, user)
    assert inv.currency == "XTR" and inv.subscription_period is None  # 90d is not recurring
    assert res.newly_processed
    assert await subs.is_entitled(session, user.id)
    end = await subs.entitlement_end(session, user.id)
    assert timedelta(days=89, hours=23) < end - utcnow() <= timedelta(days=90)
    ledger = (await session.scalars(select(LedgerEntry))).all()
    assert [(e.kind, e.amount_minor) for e in ledger] == [("charge", inv.amount)]


async def test_duplicate_successful_payment_is_idempotent(session, user):
    inv, _ = await _buy(session, user, charge="dup")
    again = await pay.process_successful_payment(session, SIGNING_KEY, user.telegram_id,
                                                 inv.payload, inv.currency, inv.amount, "dup")
    assert not again.newly_processed
    assert await session.scalar(select(func.count(Subscription.id))) == 1
    assert await session.scalar(select(func.count(LedgerEntry.id))) == 1


async def test_monthly_is_recurring_30_day_stars_subscription(session, user):
    plan = await subs.get_plan(session, "monthly")
    inv = await pay.create_invoice(session, SIGNING_KEY, user, plan)
    assert inv.subscription_period == 2592000


async def test_recurring_renewal_creates_new_payment_and_stacks(session, user):
    plan = await subs.get_plan(session, "monthly")
    inv = await pay.create_invoice(session, SIGNING_KEY, user, plan)
    r1 = await pay.process_successful_payment(session, SIGNING_KEY, user.telegram_id, inv.payload,
                                              "XTR", inv.amount, "c1", True, True)
    r2 = await pay.process_successful_payment(session, SIGNING_KEY, user.telegram_id, inv.payload,
                                              "XTR", inv.amount, "c2", True, False)
    assert r1.newly_processed and r2.newly_processed
    assert r2.ends_at - r1.ends_at == timedelta(days=30)
    assert await session.scalar(select(func.count(Payment.id))) == 2


async def test_forged_payload_rejected(session, user):
    plan = await subs.get_plan(session, "monthly")
    inv = await pay.create_invoice(session, SIGNING_KEY, user, plan)
    _, nonce, mac = inv.payload.split(":")
    with pytest.raises(pay.PaymentError, match="signature"):
        await pay.validate_pre_checkout(session, SIGNING_KEY, user.telegram_id,
                                        f"v1:{nonce}:{'0' * 32}", "XTR", inv.amount)
    with pytest.raises(pay.PaymentError):
        await pay.validate_pre_checkout(session, "other-key", user.telegram_id, inv.payload,
                                        "XTR", inv.amount)


async def test_pre_checkout_rejects_wrong_user_and_amount(session, user, other_user):
    plan = await subs.get_plan(session, "monthly")
    inv = await pay.create_invoice(session, SIGNING_KEY, user, plan)
    with pytest.raises(pay.PaymentError, match="another user"):
        await pay.validate_pre_checkout(session, SIGNING_KEY, other_user.telegram_id,
                                        inv.payload, "XTR", inv.amount)
    with pytest.raises(pay.PaymentError, match="amount"):
        await pay.validate_pre_checkout(session, SIGNING_KEY, user.telegram_id, inv.payload,
                                        "XTR", inv.amount - 1)
    with pytest.raises(pay.PaymentError, match="amount"):
        await pay.validate_pre_checkout(session, SIGNING_KEY, user.telegram_id, inv.payload,
                                        "USD", inv.amount)


async def test_success_with_mismatched_amount_does_not_activate(session, user):
    plan = await subs.get_plan(session, "monthly")
    inv = await pay.create_invoice(session, SIGNING_KEY, user, plan)
    with pytest.raises(pay.PaymentError):
        await pay.process_successful_payment(session, SIGNING_KEY, user.telegram_id, inv.payload,
                                             "XTR", 1, "cx")
    assert not await subs.is_entitled(session, user.id)


async def test_invoice_cannot_be_paid_twice(session, user):
    inv, _ = await _buy(session, user, code="annual", charge="a1")
    with pytest.raises(pay.PaymentError, match="already"):
        await pay.validate_pre_checkout(session, SIGNING_KEY, user.telegram_id, inv.payload,
                                        "XTR", inv.amount)


async def test_trial_plan_not_sold_and_trial_once(session, user):
    trial = (await subs.list_plans(session))[0]
    assert trial.is_trial
    with pytest.raises(pay.PaymentError):
        await pay.create_invoice(session, SIGNING_KEY, user, trial)
    g = await subs.start_trial(session, user)
    assert g.ends_at - g.starts_at == timedelta(days=3)
    with pytest.raises(ValueError):
        await subs.start_trial(session, user)


async def test_renewal_stacks_without_losing_days(session, user):
    _, r1 = await _buy(session, user, "quarterly", "q1")
    _, r2 = await _buy(session, user, "quarterly", "q2")
    assert r2.ends_at - r1.ends_at == timedelta(days=90)


async def test_expiry_removes_entitlement(session, user):
    _, r = await _buy(session, user, "quarterly", "q1")
    later = r.ends_at + timedelta(seconds=1)
    assert not await subs.is_entitled(session, user.id, later)
    expired = await subs.expire_due(session, later)
    assert len(expired) == 1 and expired[0].status == SubscriptionStatus.EXPIRED
    assert await subs.expire_due(session, later) == []  # idempotent


async def test_refund_revokes_access_and_writes_negative_ledger(session, user, stars_gw):
    _, r = await _buy(session, user, "quarterly", "q1")
    await pay.refund(session, stars_gw, r.payment.id, "admin:admin:abcd")
    assert stars_gw.refunds == [(user.telegram_id, "q1")]
    assert not await subs.is_entitled(session, user.id)
    amounts = [e.amount_minor for e in (await session.scalars(select(LedgerEntry))).all()]
    assert sum(amounts) == 0
    with pytest.raises(pay.PaymentError):
        await pay.refund(session, stars_gw, r.payment.id, "admin")


async def test_refund_not_recorded_if_telegram_refuses(session, user):
    from tests.conftest import FakeStarsGateway
    _, r = await _buy(session, user, "quarterly", "q1")
    with pytest.raises(pay.PaymentError):
        await pay.refund(session, FakeStarsGateway(ok=False), r.payment.id, "admin")
    p = await session.get(Payment, r.payment.id)
    assert p.status == PaymentStatus.PAID
    assert await subs.is_entitled(session, user.id)


async def test_cancel_auto_renew_keeps_access(session, user, stars_gw):
    plan = await subs.get_plan(session, "monthly")
    inv = await pay.create_invoice(session, SIGNING_KEY, user, plan)
    await pay.process_successful_payment(session, SIGNING_KEY, user.telegram_id, inv.payload,
                                         "XTR", inv.amount, "m1", True, True)
    n = await pay.cancel_auto_renew(session, stars_gw, user, f"user:{user.id}")
    assert n == 1 and stars_gw.edits == [(user.telegram_id, "m1", True)]
    assert await subs.is_entitled(session, user.id)


async def test_coupon_applies_and_counts_redemption(session, user):
    session.add(Coupon(code="SAVE20", percent_off=20, max_redemptions=1))
    await session.commit()
    plan = await subs.get_plan(session, "monthly")
    inv, _ = await _buy(session, user, "monthly", "cp1", coupon="save20")
    assert inv.amount == round(plan.price_stars * 0.8)
    assert inv.subscription_period is None  # discounted month sold as fixed period
    c = await session.scalar(select(Coupon).where(Coupon.code == "SAVE20"))
    assert c.redemptions == 1
    with pytest.raises(subs.CouponError, match="exhausted"):
        await subs.apply_coupon(session, plan, "SAVE20")


async def test_invalid_coupon(session):
    plan = await subs.get_plan(session, "monthly")
    with pytest.raises(subs.CouponError):
        await subs.apply_coupon(session, plan, "NOPE")


async def test_renewal_reminders_window(session, user):
    _, r = await _buy(session, user, "quarterly", "q1")
    t = r.ends_at - timedelta(days=2, hours=12)
    assert await subs.users_needing_reminder(session, 3, t) == [user.id]
    assert await subs.users_needing_reminder(session, 1, t) == []
