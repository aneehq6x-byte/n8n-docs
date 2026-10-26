"""Admin API endpoints used by the web dashboard."""

from __future__ import annotations

from datetime import timedelta

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import select

from tests.conftest import SIGNING_KEY, FakeStarsGateway
from umip.api.app import create_app
from umip.config import Settings
from umip.models import OutboundMessage, User
from umip.payments import service as pay
from umip.subscriptions import service as subs
from umip.timeutil import utcnow

KEYS = {"adm-key-0001": "admin", "ana-key-0002": "analyst", "sup-key-0003": "support"}
ADM, ANA, SUP = ({"X-API-Key": k} for k in KEYS)


@pytest.fixture
def gw():
    return FakeStarsGateway()


@pytest.fixture
async def client(maker, gw):
    settings = Settings(env="test", admin_api_keys=KEYS, private_channel_id=-100777,
                        telegram_webhook_secret=SecretStr("whsec"),
                        payload_signing_key=SecretStr(SIGNING_KEY))
    app = create_app(settings, maker=maker, stars_gateway=gw)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        yield c


async def _paying_user(maker, tg=111, plan="quarterly", charge="c1"):
    async with maker() as s:
        u = User(telegram_id=tg, username=f"user{tg}")
        s.add(u)
        await s.commit()
        p = await subs.get_plan(s, plan)
        inv = await pay.create_invoice(s, SIGNING_KEY, u, p)
        await pay.process_successful_payment(s, SIGNING_KEY, tg, inv.payload, "XTR", inv.amount, charge)
        return u.id, inv.amount


async def test_me_reports_role(client):
    r = (await client.get("/admin/me", headers=ANA)).json()
    assert r["role"] == "analyst" and r["key_hint"] == "…0002"


async def test_overview_and_business_metrics(client, maker):
    uid, amount = await _paying_user(maker)
    async with maker() as s:
        s.add(User(telegram_id=999, username="free"))
        await s.commit()
    r = (await client.get("/admin/overview", headers=SUP)).json()
    b = r["business"]
    assert b["revenue_window"] == amount and b["paying_users"] == 1 and b["total_users"] == 2
    assert b["conversion_rate"] == 0.5 and b["active_subscribers"] == 1
    assert len(b["series"]) == 30 and b["series"][-1]["revenue"] == amount
    assert r["publish_mode"] == "human_approval" and r["kill_switch"] is False
    assert any(a["code"] == "mock_data" for a in r["alerts"])


async def test_users_search_filter_and_detail(client, maker):
    uid, amount = await _paying_user(maker, tg=4242)
    async with maker() as s:
        s.add(User(telegram_id=5151, username="nopay"))
        await s.commit()
    r = (await client.get("/admin/users?status=active", headers=SUP)).json()
    assert r["total"] == 1 and r["items"][0]["telegram_id"] == 4242
    assert r["items"][0]["paid_total"] == amount and r["items"][0]["access_until"]
    assert (await client.get("/admin/users?q=@nopay", headers=SUP)).json()["total"] == 1
    assert (await client.get("/admin/users?q=4242", headers=SUP)).json()["total"] == 1
    assert (await client.get("/admin/users?status=inactive", headers=SUP)).json()["total"] == 1
    d = (await client.get(f"/admin/users/{uid}", headers=SUP)).json()
    assert d["subscriptions"][0]["plan"] == "quarterly" and d["payments"][0]["status"] == "paid"


async def test_block_and_comp_grant_are_admin_only_and_audited(client, maker):
    async with maker() as s:
        u = User(telegram_id=77, username="x")
        s.add(u)
        await s.commit()
        uid = u.id
    body = {"plan_code": "monthly", "reason": "partner access"}
    assert (await client.post(f"/admin/users/{uid}/grant", json=body, headers=ANA)).status_code == 403
    r = await client.post(f"/admin/users/{uid}/grant", json=body, headers=ADM)
    assert r.status_code == 200
    r = await client.post(f"/admin/users/{uid}/block", json={"blocked": True, "reason": "abuse"},
                          headers=ADM)
    assert r.json()["is_blocked"] is True
    actions = [a["action"] for a in (await client.get("/admin/audit", headers=ADM)).json()["items"]]
    assert {"subscription.comp_granted", "user.blocked"} <= set(actions)


MANUAL = {"symbol": "spy", "direction": "long", "entry_low": 600, "entry_high": 600.5, "stop": 598,
          "target1": 604, "target2": 608, "invalidation": "close below 599",
          "reason": "Manual setup: reclaim of VWAP with breadth support", "valid_minutes": 30}


async def test_manual_signal_validation_and_review_flow(client, maker):
    bad = {**MANUAL, "stop": 601}
    r = await client.post("/admin/signals", json=bad, headers=ANA)
    assert r.status_code == 422 and "stop must be below" in str(r.json())
    low_rr = {**MANUAL, "target1": 601, "target2": 602}
    assert (await client.post("/admin/signals", json=low_rr, headers=ANA)).status_code == 422
    assert (await client.post("/admin/signals", json=MANUAL, headers=SUP)).status_code == 403

    r = await client.post("/admin/signals", json=MANUAL, headers=ANA)
    assert r.status_code == 201
    sig = r.json()
    assert sig["status"] == "validated" and sig["symbol"] == "SPY"
    assert sig["created_by"].startswith("admin:analyst") and sig["strategy"] == "manual"
    ref = sig["ref"]
    r = await client.post(f"/admin/signals/{ref}/decision", json={"approve": True}, headers=ANA)
    assert r.json()["status"] == "published"

    # record tracking outcomes; closing requires r_net
    assert (await client.post(f"/admin/signals/{ref}/status", json={"to": "active"},
                              headers=ANA)).json()["status"] == "active"
    r = await client.post(f"/admin/signals/{ref}/status", json={"to": "stopped"}, headers=ANA)
    assert r.status_code == 422
    r = await client.post(f"/admin/signals/{ref}/status", json={"to": "stopped", "r_net": -1.05},
                          headers=ANA)
    assert r.json()["status"] == "stopped"
    r = await client.post(f"/admin/signals/{ref}/status", json={"to": "active"}, headers=ANA)
    assert r.status_code == 409

    d = (await client.get(f"/admin/signals/{ref}", headers=ANA)).json()
    assert [h["to"] for h in d["history"]] == ["candidate", "validated", "approved", "published",
                                                "active", "stopped"]
    assert d["allowed_transitions"] == []
    perf = (await client.get("/admin/performance?kind=published", headers=ANA)).json()
    assert perf["overall"]["trades"] == 1 and perf["overall"]["total_r"] == -1.05
    assert perf["equity_curve"][0]["cum_r"] == -1.05 and "by_session" in perf
    async with maker() as s:
        keys = [m.dedup_key for m in (await s.scalars(select(OutboundMessage))).all()]
    assert keys == [f"signal:{ref}:published", f"signal:{ref}:active", f"signal:{ref}:stopped"]


async def test_paper_signal_is_not_published_to_channel(client, maker):
    r = await client.post("/admin/signals", json={**MANUAL, "kind": "paper"}, headers=ANA)
    ref = r.json()["ref"]
    r = await client.post(f"/admin/signals/{ref}/decision", json={"approve": True}, headers=ANA)
    assert r.json()["status"] == "approved"
    async with maker() as s:
        assert (await s.scalars(select(OutboundMessage))).all() == []


async def test_cancel_before_publication(client):
    ref = (await client.post("/admin/signals", json=MANUAL, headers=ANA)).json()["ref"]
    r = await client.post(f"/admin/signals/{ref}/status", json={"to": "cancelled", "note": "news"},
                          headers=ANA)
    assert r.json()["status"] == "cancelled"


async def test_kill_switch_blocks_manual_signals(client):
    await client.post("/admin/kill-switch", json={"on": True}, headers=ADM)
    assert (await client.post("/admin/signals", json=MANUAL, headers=ANA)).status_code == 409


async def test_publish_mode_override_and_strategy_toggle(client):
    r = await client.post("/admin/system/publish-mode", json={"mode": "automatic"}, headers=ADM)
    assert r.json()["publish_mode"] == "automatic"
    assert (await client.post("/admin/system/publish-mode", json={"mode": "automatic"},
                              headers=ANA)).status_code == 403
    r = await client.post("/admin/system/strategies", json={"name": "orb", "disabled": True}, headers=ADM)
    assert r.json()["disabled"] == ["orb"]
    assert (await client.post("/admin/system/strategies", json={"name": "nope", "disabled": True},
                              headers=ADM)).status_code == 404
    sysinfo = (await client.get("/admin/system", headers=SUP)).json()
    assert sysinfo["publish_mode"] == "automatic" and sysinfo["publish_mode_default"] == "human_approval"
    assert {"name": "orb", "disabled": True} in sysinfo["strategies"]


async def test_dead_letter_retry(client, maker):
    async with maker() as s:
        s.add(OutboundMessage(dedup_key="k", chat_id=1, payload={"text": "x"}, status="dead",
                              attempts=5, last_error="502"))
        await s.commit()
    sysinfo = (await client.get("/admin/system", headers=SUP)).json()
    mid = sysinfo["dead_letters"][0]["id"]
    assert sysinfo["outbox"] == {"dead": 1}
    r = await client.post(f"/admin/outbox/{mid}/retry", headers=ADM)
    assert r.json()["status"] == "pending"
    assert (await client.post(f"/admin/outbox/{mid}/retry", headers=ADM)).status_code == 409


async def test_plans_and_coupons(client):
    r = await client.patch("/admin/plans/monthly", json={"price_stars": 20000}, headers=ADM)
    assert r.status_code == 422  # above recurring Stars cap
    r = await client.patch("/admin/plans/trial", json={"price_stars": 5}, headers=ADM)
    assert r.status_code == 422
    r = await client.patch("/admin/plans/annual", json={"name_en": "Yearly", "price_stars": 13000},
                           headers=ADM)
    assert r.json()["name_en"] == "Yearly"
    r = await client.post("/admin/coupons", json={"code": "launch25", "percent_off": 25,
                                                   "max_redemptions": 100}, headers=ADM)
    assert r.status_code == 201 and r.json()["code"] == "LAUNCH25"
    assert (await client.post("/admin/coupons", json={"code": "LAUNCH25", "percent_off": 10},
                              headers=ADM)).status_code == 409
    assert (await client.post("/admin/coupons", json={"code": "x y", "percent_off": 10},
                              headers=ADM)).status_code == 422
    r = await client.patch("/admin/coupons/launch25", json={"active": False}, headers=ADM)
    assert r.json()["active"] is False
    assert len((await client.get("/admin/coupons", headers=ADM)).json()) == 1


async def test_refund_via_gateway(client, maker, gw):
    uid, _ = await _paying_user(maker, tg=31, charge="ch-refund")
    page = (await client.get(f"/admin/payments?user_id={uid}", headers=ADM)).json()
    pid = page["items"][0]["id"]
    r = await client.post(f"/admin/payments/{pid}/refund", json={"reason": "duplicate"}, headers=ADM)
    assert r.status_code == 200 and r.json()["status"] == "refunded"
    assert gw.refunds == [(31, "ch-refund")]
    assert (await client.post(f"/admin/payments/{pid}/refund", json={"reason": "again"},
                              headers=ADM)).status_code == 409
    ov = (await client.get("/admin/overview", headers=SUP)).json()["business"]
    assert ov["revenue_window"] == 0 and ov["refunds_window"] > 0


async def test_refund_unavailable_without_bot(maker):
    settings = Settings(env="test", admin_api_keys=KEYS)
    app = create_app(settings, maker=maker)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        r = await c.post("/admin/payments/1/refund", json={"reason": "x" * 5}, headers=ADM)
        assert r.status_code == 503


async def test_churn_metric(client, maker):
    async with maker() as s:
        u = User(telegram_id=1, username="old")
        s.add(u)
        await s.commit()
        plan = await subs.get_plan(s, "monthly")
        await subs.grant_period(s, u, plan, None, "t", now=utcnow() - timedelta(days=40))
        await s.commit()
    b = (await client.get("/admin/stats", headers=SUP)).json()
    assert b["churned_users_window"] == 1 and b["churn_rate_window"] == 1.0
