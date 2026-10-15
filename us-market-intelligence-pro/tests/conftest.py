from __future__ import annotations

import os
from datetime import datetime, timezone

import pytest

from umip.db import Base, create_all, make_engine, make_sessionmaker
from umip.models import User
from umip.subscriptions.service import seed_default_plans

# Tuesday 2026-03-10 11:00 New York (EDT, after the 2026-03-08 DST switch)
MARKET_NOW = datetime(2026, 3, 10, 15, 0, tzinfo=timezone.utc)
SIGNING_KEY = "test-signing-key"


@pytest.fixture
async def maker():
    # Set UMIP_TEST_DATABASE_URL=postgresql+asyncpg://... to run the suite on PostgreSQL.
    url = os.environ.get("UMIP_TEST_DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    engine = make_engine(url)
    if not url.startswith("sqlite"):
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
    await create_all(engine)
    m = make_sessionmaker(engine)
    async with m() as s:
        await seed_default_plans(s)
    yield m
    await engine.dispose()


@pytest.fixture
async def session(maker):
    async with maker() as s:
        yield s


@pytest.fixture
async def user(session):
    u = User(telegram_id=111, username="alice", language="ar")
    session.add(u)
    await session.commit()
    return u


@pytest.fixture
async def other_user(session):
    u = User(telegram_id=222, username="bob", language="en")
    session.add(u)
    await session.commit()
    return u


class FakeChatGateway:
    def __init__(self):
        self.created, self.revoked, self.approved, self.declined, self.removed = [], [], [], [], []
        self._n = 0

    async def create_invite_link(self, chat_id, name, expire_date, member_limit, creates_join_request):
        self._n += 1
        link = f"https://t.me/+fake{self._n}"
        self.created.append((link, expire_date, creates_join_request))
        return link

    async def revoke_invite_link(self, chat_id, link):
        self.revoked.append(link)

    async def approve_join_request(self, chat_id, user_id):
        self.approved.append(user_id)

    async def decline_join_request(self, chat_id, user_id):
        self.declined.append(user_id)

    async def remove_member(self, chat_id, user_id):
        self.removed.append(user_id)


class FakeStarsGateway:
    def __init__(self, ok=True):
        self.ok = ok
        self.refunds, self.edits = [], []

    async def refund_star_payment(self, user_id, charge_id):
        self.refunds.append((user_id, charge_id))
        return self.ok

    async def edit_user_star_subscription(self, user_id, charge_id, is_canceled):
        self.edits.append((user_id, charge_id, is_canceled))
        return True


@pytest.fixture
def chat_gw():
    return FakeChatGateway()


@pytest.fixture
def stars_gw():
    return FakeStarsGateway()
