"""Periodic maintenance jobs. Each is idempotent so a restart or a double run
never double-notifies or double-charges."""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from umip.bot.i18n import t
from umip.membership.service import ChatGateway, remove_expired_members
from umip.models import User
from umip.notifications import enqueue
from umip.signals import service as sigsvc
from umip.subscriptions.service import entitlement_end, expire_due, users_needing_reminder
from umip.timeutil import NY, format_dual, utcnow


async def subscription_maintenance(session: AsyncSession, gw: ChatGateway | None,
                                   private_chat_id: int | None, reminder_days: list[int],
                                   grace: timedelta = timedelta(0),
                                   now: datetime | None = None) -> dict:
    now = now or utcnow()
    expired = await expire_due(session, now)
    for sub in expired:
        if await entitlement_end(session, sub.user_id, now) is None:
            user = await session.get(User, sub.user_id)
            await enqueue(session, f"sub:{sub.id}:expired", user.telegram_id,
                          {"text": t("expired", user.language)})
    removed = []
    if gw and private_chat_id:
        removed = await remove_expired_members(session, gw, private_chat_id, grace, now)
    reminded = 0
    for days in reminder_days:
        for uid in await users_needing_reminder(session, days, now):
            user = await session.get(User, uid)
            end = await entitlement_end(session, uid, now)
            key = f"remind:{uid}:{end.astimezone(NY).date()}:{days}"
            if await enqueue(session, key, user.telegram_id,
                             {"text": t("renew_reminder", user.language, days=days,
                                        end=format_dual(end))}):
                reminded += 1
    await session.commit()
    return {"expired": len(expired), "removed": len(removed), "reminded": reminded}


async def signal_maintenance(session: AsyncSession, now: datetime | None = None) -> int:
    return len(await sigsvc.expire_due(session, now))

