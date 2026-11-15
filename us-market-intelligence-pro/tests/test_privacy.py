from __future__ import annotations

import httpx
import pytest
from sqlalchemy import func, select

from tests.conftest import SIGNING_KEY, FakeChatGateway
from umip.api.app import create_app
from umip.api.security import hash_key
from umip.audit import audit
from umip.config import Settings
from umip.membership import service as mem
from umip.models import (
    AIUsage, AuditLog, ChannelMember, InviteLink, LedgerEntry, OutboundMessage, Payment, User,
)
from umip.notifications import enqueue
from umip.payments import service as pay
from umip.privacy import PrivacyError, erase_user, export_user_data
from umip.ratelimit import MemoryRateLimiter
from umip.subscriptions import service as subs

CHAT = -100555


async def _member(session, user, gw):
    plan = await subs.get_plan(session, "quarterly")
    inv = await pay.create_invoice(session, SIGNING_KEY, user, plan)
    await pay.process_successful_payment(session, SIGNING_KEY, user.telegram_id, inv.payload, "XTR",
                                         inv.amount, "ch-priv", raw={"order_info": {"name": "Sara"}})
    link = await mem.issue_invite(session, gw, user, CHAT, 900)
    await mem.handle_join_request(session, gw, CHAT, user.telegram_id, link)
    await mem.issue_invite(session, gw, user, CHAT, 900)  # an outstanding unused link
    session.add(AIUsage(user_id=user.id, day="2026-03-10", count=3))
    await enqueue(session, "remind:x", user.telegram_id, {"text": "renew"})
    await audit(session, "membership", "membership.join_declined", f"tg:{user.telegram_id}")
    await session.commit()


async def test_erasure_anonymises_and_keeps_financial_records(session, user, chat_gw):
    await _member(session, user, chat_gw)
    tg = user.telegram_id
    ledger_before = await session.scalar(select(func.sum(LedgerEntry.amount_minor)))
    exported = await export_user_data(session, user)
    assert exported["user"]["telegram_id"] == tg and exported["payments"][0]["status"] == "paid"

    res = await erase_user(session, user, "admin:admin:abcd1234", "user request via support", chat_gw)
    assert res["removed_from_channels"] == [CHAT] and chat_gw.removed == [tg]
    assert user.telegram_id == -user.id and user.username is None and user.is_blocked and user.deleted_at
    assert not await subs.is_entitled(session, user.id)
    assert await session.scalar(select(func.count(InviteLink.id))) == 0
    assert await session.scalar(select(func.count(AIUsage.id))) == 0
    assert await session.scalar(select(func.count(OutboundMessage.id)).where(OutboundMessage.chat_id == tg)) == 0
    p = await session.scalar(select(Payment))
    assert p.raw is None and p.provider_charge_id == "ch-priv"            # kept for refunds/disputes
    assert await session.scalar(select(func.sum(LedgerEntry.amount_minor))) == ledger_before
    m = await session.scalar(select(ChannelMember))
    assert m.is_member is False
    targets = [a.target for a in (await session.scalars(select(AuditLog))).all()]
    assert f"tg:{tg}" not in targets and "tg:erased" in targets
    erased = [a for a in (await session.scalars(select(AuditLog).where(AuditLog.action == "user.erased"))).all()]
    assert len(erased) == 1 and str(tg) not in str(erased[0].data)
    # nothing left anywhere that carries the Telegram id
    for model, col in [(User, User.telegram_id), (OutboundMessage, OutboundMessage.chat_id)]:
        assert await session.scalar(select(func.count()).select_from(model).where(col == tg)) == 0


async def test_erasure_is_idempotent(session, user, chat_gw):
    await erase_user(session, user, "admin:admin:x", "test", chat_gw)
    assert (await erase_user(session, user, "admin:admin:x", "again", chat_gw))["already_erased"]
    assert await session.scalar(select(func.count(AuditLog.id)).where(AuditLog.action == "user.erased")) == 1


async def test_refuses_to_erase_channel_member_without_bot(session, user, chat_gw):
    await _member(session, user, chat_gw)
    with pytest.raises(PrivacyError):
        await erase_user(session, user, "admin:admin:x", "test", None)
    assert user.deleted_at is None  # nothing changed


async def test_non_member_can_be_erased_without_bot(session, user):
    res = await erase_user(session, user, "admin:admin:x", "test", None)
    assert res["removed_from_channels"] == [] and user.deleted_at is not None


KEYS = {hash_key("adm-key-0001"): "admin", hash_key("ana-key-0002"): "analyst"}


async def test_admin_export_and_erase_endpoints(maker):
    gw = FakeChatGateway()
    app = create_app(Settings(env="test", admin_api_keys=KEYS), maker=maker, limiter=MemoryRateLimiter(),
                     chat_gateway=gw)
    async with maker() as s:
        u = User(telegram_id=4242, username="dana")
        s.add(u)
        await s.commit()
        uid = u.id
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        adm, ana = {"X-API-Key": "adm-key-0001"}, {"X-API-Key": "ana-key-0002"}
        assert (await c.get(f"/admin/users/{uid}/export", headers=ana)).status_code == 403
        data = (await c.get(f"/admin/users/{uid}/export", headers=adm)).json()
        assert data["user"]["username"] == "dana"
        assert (await c.post(f"/admin/users/{uid}/erase", json={"reason": "x"}, headers=adm)).status_code == 422
        r = await c.post(f"/admin/users/{uid}/erase", json={"reason": "PDPL request #12"}, headers=adm)
        assert r.status_code == 200 and r.json()["already_erased"] is False
        d = (await c.get(f"/admin/users/{uid}", headers=adm)).json()
        assert d["username"] is None and d["telegram_id"] == -uid and d["deleted_at"]
        actions = [a["action"] for a in (await c.get("/admin/audit", headers=adm)).json()["items"]]
        assert {"user.exported", "user.erased"} <= set(actions)
