"""Runtime switches persisted in the DB (survive restarts)."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from umip.audit import audit
from umip.models import SystemFlag

KILL_SWITCH = "kill_switch"
PUBLISH_MODE = "publish_mode"
DISABLED_STRATEGIES = "disabled_strategies"


async def get_flag(session: AsyncSession, key: str, default=None):
    f = await session.get(SystemFlag, key)
    return f.value.get("v") if f else default


async def set_flag(session: AsyncSession, key: str, value, actor: str) -> None:
    f = await session.get(SystemFlag, key)
    if f is None:
        session.add(SystemFlag(key=key, value={"v": value}, updated_by=actor))
    else:
        f.value = {"v": value}
        f.updated_by = actor
    await audit(session, actor, f"flag.{key}", None, value=value)
    await session.commit()


async def kill_switch_on(session: AsyncSession) -> bool:
    return bool(await get_flag(session, KILL_SWITCH, False))
