"""Private channel access control.

Policy:
- Links are per-user, single-use (member_limit=1) or join-request links, short TTL.
- Join requests are approved only if the requesting Telegram user is entitled.
- Joins through a link issued to someone else are kicked (link sharing).
- Expired users are removed (ban + immediate unban so they can rejoin later after
  renewing, but only through a fresh link).
- Every action is audited.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from umip.audit import audit
from umip.models import ChannelMember, InviteLink, User
from umip.subscriptions.service import entitlement_end, is_entitled
from umip.timeutil import ensure_utc, utcnow


class ChatGateway(Protocol):
    async def create_invite_link(self, chat_id: int, name: str, expire_date: datetime,
                                 member_limit: int | None, creates_join_request: bool) -> str: ...
    async def revoke_invite_link(self, chat_id: int, link: str) -> None: ...
    async def approve_join_request(self, chat_id: int, user_id: int) -> None: ...
    async def decline_join_request(self, chat_id: int, user_id: int) -> None: ...
    async def remove_member(self, chat_id: int, user_id: int) -> None: ...


class AccessDenied(PermissionError):
    pass


async def issue_invite(session: AsyncSession, gw: ChatGateway, user: User, chat_id: int,
                       ttl_seconds: int, now: datetime | None = None) -> str:
    now = now or utcnow()
    if not await is_entitled(session, user.id, now):
        raise AccessDenied("no active subscription")
    # Revoke any outstanding links first: one live link per user.
    q = select(InviteLink).where(InviteLink.user_id == user.id, InviteLink.chat_id == chat_id,
                                 InviteLink.revoked.is_(False), InviteLink.used_at.is_(None))
    for old in (await session.scalars(q)).all():
        await gw.revoke_invite_link(chat_id, old.link)
        old.revoked = True
    end = await entitlement_end(session, user.id, now)
    expires = min(now + timedelta(seconds=ttl_seconds), end)
    # Join-request link: lets us re-check entitlement and identity at join time.
    link = await gw.create_invite_link(chat_id, f"u{user.id}", expires, None, True)
    session.add(InviteLink(user_id=user.id, chat_id=chat_id, link=link, expires_at=expires))
    await audit(session, f"user:{user.id}", "membership.invite_issued", f"chat:{chat_id}",
                expires_at=expires.isoformat())
    await session.commit()
    return link


async def handle_join_request(session: AsyncSession, gw: ChatGateway, chat_id: int,
                              telegram_user_id: int, invite_link: str | None,
                              now: datetime | None = None) -> bool:
    now = now or utcnow()
    user = await session.scalar(select(User).where(User.telegram_id == telegram_user_id))
    reason = None
    link_row = None
    if user is None:
        reason = "unknown user"
    elif not await is_entitled(session, user.id, now):
        reason = "not entitled"
    elif invite_link is not None:
        link_row = await session.scalar(select(InviteLink).where(InviteLink.link == invite_link))
        if link_row is None or link_row.user_id != user.id:
            reason = "link issued to another user"
        elif link_row.revoked or link_row.used_at or ensure_utc(link_row.expires_at) <= now:
            reason = "link expired or used"
    if reason:
        await gw.decline_join_request(chat_id, telegram_user_id)
        await audit(session, "membership", "membership.join_declined",
                    f"tg:{telegram_user_id}", chat_id=chat_id, reason=reason)
        await session.commit()
        return False

    await gw.approve_join_request(chat_id, telegram_user_id)
    if link_row:
        link_row.used_at = now
        await gw.revoke_invite_link(chat_id, link_row.link)
        link_row.revoked = True
    await _mark_member(session, user.id, chat_id, True, now)
    await audit(session, "membership", "membership.join_approved", f"user:{user.id}",
                chat_id=chat_id)
    await session.commit()
    return True


async def _mark_member(session: AsyncSession, user_id: int, chat_id: int, is_member: bool,
                       now: datetime) -> None:
    m = await session.scalar(select(ChannelMember).where(ChannelMember.user_id == user_id,
                                                         ChannelMember.chat_id == chat_id))
    if m is None:
        m = ChannelMember(user_id=user_id, chat_id=chat_id)
        session.add(m)
    m.is_member = is_member
    if is_member:
        m.joined_at, m.removed_at = now, None
    else:
        m.removed_at = now


async def remove_expired_members(session: AsyncSession, gw: ChatGateway, chat_id: int,
                                 grace: timedelta = timedelta(0),
                                 now: datetime | None = None) -> list[int]:
    """Remove members whose entitlement ended more than ``grace`` ago."""
    now = now or utcnow()
    q = select(ChannelMember).where(ChannelMember.chat_id == chat_id,
                                    ChannelMember.is_member.is_(True))
    removed = []
    for m in (await session.scalars(q)).all():
        if await is_entitled(session, m.user_id, now - grace):
            continue
        if await is_entitled(session, m.user_id, now):
            continue
        user = await session.get(User, m.user_id)
        await gw.remove_member(chat_id, user.telegram_id)
        await _mark_member(session, m.user_id, chat_id, False, now)
        await audit(session, "membership", "membership.removed", f"user:{m.user_id}",
                    chat_id=chat_id, reason="expired")
        removed.append(m.user_id)
    await session.commit()
    return removed
