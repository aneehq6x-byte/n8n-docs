"""Personal-data access and erasure (Saudi PDPL / general data-subject rights).

Erasure anonymises instead of deleting the user row, because payments, the
ledger and subscription periods must be retained for accounting/legal periods
and reference the user by id. After erasure nothing in the database identifies
the person:

- users: telegram_id → -id (cannot collide with real ids), username, referral
  code and last-seen cleared; blocked; deleted_at set.
- private-channel access removed now through the bot. Without a bot gateway,
  erasing a current channel member is refused: once the Telegram id is gone the
  person could no longer be removed.
- invite links revoked and deleted; AI usage deleted; unsent outbound messages
  to the person deleted; payment ``raw`` payloads dropped (charge ids kept for
  refunds/disputes); audit targets that carried the Telegram id rewritten.
- one audit entry records who erased, when and why — without personal data.

The retention period and any legal holds must be confirmed by counsel.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from umip.audit import audit
from umip.membership.service import ChatGateway
from umip.models import (
    AIUsage, AuditLog, ChannelMember, InviteLink, OutboundMessage, Payment, Subscription,
    SubscriptionStatus, User,
)
from umip.timeutil import utcnow


class PrivacyError(RuntimeError):
    pass


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


async def export_user_data(session: AsyncSession, user: User) -> dict:
    """Everything stored about one person, as JSON-serialisable data."""
    subs = (await session.scalars(select(Subscription).where(Subscription.user_id == user.id))).all()
    pays = (await session.scalars(select(Payment).where(Payment.user_id == user.id))).all()
    members = (await session.scalars(select(ChannelMember).where(ChannelMember.user_id == user.id))).all()
    ai = (await session.scalars(select(AIUsage).where(AIUsage.user_id == user.id))).all()
    return {
        "generated_at": utcnow().isoformat(),
        "user": {"id": user.id, "telegram_id": user.telegram_id, "username": user.username,
                 "language": user.language, "timezone": user.timezone_pref,
                 "accepted_terms_at": _iso(user.accepted_terms_at), "created_at": _iso(user.created_at),
                 "last_seen_at": _iso(user.last_seen_at), "deleted_at": _iso(user.deleted_at)},
        "subscriptions": [{"plan": s.plan.code, "starts_at": _iso(s.starts_at), "ends_at": _iso(s.ends_at),
                           "status": s.status.value, "auto_renew": s.auto_renew} for s in subs],
        "payments": [{"id": p.id, "amount": p.amount_minor, "currency": p.currency, "status": p.status.value,
                      "paid_at": _iso(p.paid_at), "refunded_at": _iso(p.refunded_at),
                      "telegram_payment_charge_id": p.provider_charge_id} for p in pays],
        "channel_membership": [{"chat_id": m.chat_id, "is_member": m.is_member, "joined_at": _iso(m.joined_at),
                                "removed_at": _iso(m.removed_at)} for m in members],
        "ai_usage": [{"day": a.day, "count": a.count} for a in ai],
        "notes": "Signals are market content and contain no personal data; they are not included.",
    }


async def erase_user(session: AsyncSession, user: User, actor: str, reason: str,
                     gw: ChatGateway | None = None, now: datetime | None = None) -> dict:
    """Anonymise a user. Idempotent: erasing an erased user changes nothing."""
    now = now or utcnow()
    if user.deleted_at is not None:
        return {"already_erased": True}
    tg = user.telegram_id
    removed_from: list[int] = []

    members = (await session.scalars(select(ChannelMember).where(ChannelMember.user_id == user.id,
                                                                 ChannelMember.is_member.is_(True)))).all()
    if members and gw is None:
        raise PrivacyError("user is a channel member and the bot is not configured to remove them")
    for m in members:
        await gw.remove_member(m.chat_id, tg)
        m.is_member, m.removed_at = False, now
        removed_from.append(m.chat_id)
    for link in (await session.scalars(select(InviteLink).where(InviteLink.user_id == user.id))).all():
        if gw is not None and not link.revoked and link.used_at is None:
            await gw.revoke_invite_link(link.chat_id, link.link)
    await session.execute(delete(InviteLink).where(InviteLink.user_id == user.id))
    await session.execute(delete(AIUsage).where(AIUsage.user_id == user.id))
    await session.execute(delete(OutboundMessage).where(OutboundMessage.chat_id == tg,
                                                        OutboundMessage.status.in_(("pending", "failed", "dead"))))
    await session.execute(update(Payment).where(Payment.user_id == user.id).values(raw=None))
    # End access: entitlement depends on active periods (financial rows are kept).
    await session.execute(update(Subscription).where(
        Subscription.user_id == user.id,
        Subscription.status.in_((SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED)))
        .values(status=SubscriptionStatus.EXPIRED, auto_renew=False))
    await session.execute(update(AuditLog).where(AuditLog.target == f"tg:{tg}").values(target="tg:erased"))

    user.telegram_id = -user.id
    user.username = None
    user.referral_code = None
    user.last_seen_at = None
    user.is_blocked = True
    user.deleted_at = now
    await audit(session, actor, "user.erased", f"user:{user.id}", reason=reason[:300],
                removed_from_channels=len(removed_from))
    await session.commit()
    return {"already_erased": False, "removed_from_channels": removed_from}

