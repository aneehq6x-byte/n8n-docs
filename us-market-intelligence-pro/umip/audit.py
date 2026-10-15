from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from umip.models import AuditLog


async def audit(
    session: AsyncSession, actor: str, action: str, target: str | None = None, **data: Any
) -> None:
    """Record an audit entry in the caller's transaction (committed with it)."""
    session.add(AuditLog(actor=actor, action=action, target=target, data=data or None))
