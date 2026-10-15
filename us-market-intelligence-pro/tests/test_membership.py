from __future__ import annotations

from datetime import timedelta

import pytest

from umip.membership import service as mem
from umip.models import AuditLog
from umip.subscriptions import service as subs
from umip.timeutil import utcnow
from sqlalchemy import select

CHAT = -100123


async def _entitle(session, user, days_plan="quarterly"):
    plan = await subs.get_plan(session, days_plan)
    g = await subs.grant_period(session, user, plan, None, "test")
    await session.commit()
    return g


async def test_invite_requires_entitlement(session, user, chat_gw):
    with pytest.raises(mem.AccessDenied):
        await mem.issue_invite(session, chat_gw, user, CHAT, 900)
    await _entitle(session, user)
    link = await mem.issue_invite(session, chat_gw, user, CHAT, 900)
    assert link.startswith("https://t.me/+")
    _, expires, join_req = chat_gw.created[0]
    assert join_req and expires - utcnow() <= timedelta(seconds=900)


async def test_new_invite_revokes_previous(session, user, chat_gw):
    await _entitle(session, user)
    first = await mem.issue_invite(session, chat_gw, user, CHAT, 900)
    await mem.issue_invite(session, chat_gw, user, CHAT, 900)
    assert chat_gw.revoked == [first]


async def test_join_request_approved_and_link_single_use(session, user, chat_gw):
    await _entitle(session, user)
    link = await mem.issue_invite(session, chat_gw, user, CHAT, 900)
    assert await mem.handle_join_request(session, chat_gw, CHAT, user.telegram_id, link)
    assert chat_gw.approved == [user.telegram_id] and link in chat_gw.revoked
    # replaying the same link is declined
    assert not await mem.handle_join_request(session, chat_gw, CHAT, user.telegram_id, link)


async def test_shared_link_declined(session, user, other_user, chat_gw):
    await _entitle(session, user)
    await _entitle(session, other_user)
    link = await mem.issue_invite(session, chat_gw, user, CHAT, 900)
    assert not await mem.handle_join_request(session, chat_gw, CHAT, other_user.telegram_id, link)
    assert chat_gw.declined == [other_user.telegram_id]


async def test_unentitled_join_declined(session, user, chat_gw):
    assert not await mem.handle_join_request(session, chat_gw, CHAT, user.telegram_id, None)
    assert not await mem.handle_join_request(session, chat_gw, CHAT, 99999, None)


async def test_expired_member_removed_and_can_return_after_renewal(session, user, chat_gw):
    g = await _entitle(session, user)
    link = await mem.issue_invite(session, chat_gw, user, CHAT, 900)
    await mem.handle_join_request(session, chat_gw, CHAT, user.telegram_id, link)
    # still entitled: nothing removed
    assert await mem.remove_expired_members(session, chat_gw, CHAT) == []
    after = g.ends_at + timedelta(minutes=1)
    # within grace: kept
    assert await mem.remove_expired_members(session, chat_gw, CHAT, timedelta(hours=1), after) == []
    assert await mem.remove_expired_members(session, chat_gw, CHAT, timedelta(0), after) == [user.id]
    assert chat_gw.removed == [user.telegram_id]
    # renew -> fresh link works
    plan = await subs.get_plan(session, "monthly")
    await subs.grant_period(session, user, plan, None, "test", now=after)
    await session.commit()
    link2 = await mem.issue_invite(session, chat_gw, user, CHAT, 900, now=after)
    assert await mem.handle_join_request(session, chat_gw, CHAT, user.telegram_id, link2, now=after)
    actions = [a.action for a in (await session.scalars(select(AuditLog))).all()]
    assert "membership.removed" in actions and actions.count("membership.join_approved") == 2
