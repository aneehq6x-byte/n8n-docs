"""Transactional outbox for Telegram messages.

Messages are enqueued in the same DB transaction as the state change that
caused them, keyed by a dedup key. A dispatcher sends pending messages with
bounded retries; after ``max_attempts`` they become ``dead`` (dead-letter) and
raise an admin alert. Restarts re-dispatch only unsent rows, so no duplicates.
"""

from __future__ import annotations

from typing import Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from umip.models import OutboundMessage
from umip.timeutil import utcnow


class Sender(Protocol):
    async def send(self, chat_id: int, payload: dict) -> None: ...


async def enqueue(session: AsyncSession, dedup_key: str, chat_id: int, payload: dict) -> bool:
    """Returns False if this key was already enqueued (idempotent)."""
    exists = await session.scalar(select(OutboundMessage.id).where(
        OutboundMessage.dedup_key == dedup_key))
    if exists:
        return False
    session.add(OutboundMessage(dedup_key=dedup_key, chat_id=chat_id, payload=payload))
    return True


async def dispatch(session: AsyncSession, sender: Sender, max_attempts: int = 5,
                   batch: int = 50) -> dict[str, int]:
    q = (select(OutboundMessage).where(OutboundMessage.status.in_(("pending", "failed")))
         .order_by(OutboundMessage.id).limit(batch))
    stats = {"sent": 0, "failed": 0, "dead": 0}
    for m in (await session.scalars(q)).all():
        m.attempts += 1
        try:
            await sender.send(m.chat_id, m.payload)
        except Exception as e:  # noqa: BLE001 - any transport error is retried
            m.last_error = str(e)[:500]
            m.status = "dead" if m.attempts >= max_attempts else "failed"
            stats[m.status] += 1
        else:
            m.status, m.sent_at = "sent", utcnow()
            stats["sent"] += 1
        await session.commit()
    return stats
