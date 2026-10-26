from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import select

from umip.ai.agents import Capability, allowed, require
from umip.ai.assistant import QuotaExceeded, ResearchAssistant, consume_quota, ungrounded_numbers
from umip.api.app import create_app
from umip.config import Settings
from umip.models import OutboundMessage, Signal
from umip.quant.strategies import Candidate
from umip.risk.engine import RiskDecision
from umip.signals import service as sig
from umip.timeutil import utcnow

KEYS = {"adm-key-0001": "admin", "ana-key-0002": "analyst", "sup-key-0003": "support"}


def _settings(**kw):
    return Settings(env="test", admin_api_keys=KEYS, private_channel_id=-100777,
                    telegram_webhook_secret=SecretStr("whsec"), **kw)


@pytest.fixture
async def client(maker):
    app = create_app(_settings(), maker=maker)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://t") as c:
        yield c


async def test_health(client):
    r = await client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


async def test_webhook_requires_secret_token(client):
    assert (await client.post("/telegram/webhook", json={})).status_code == 403
    r = await client.post("/telegram/webhook", json={},
                          headers={"X-Telegram-Bot-Api-Secret-Token": "wrong"})
    assert r.status_code == 403
    r = await client.post("/telegram/webhook", json={},
                          headers={"X-Telegram-Bot-Api-Secret-Token": "whsec"})
    assert r.status_code == 503  # authenticated, but no bot configured in tests


async def test_rbac(client):
    assert (await client.get("/admin/stats")).status_code == 401
    assert (await client.get("/admin/stats", headers={"X-API-Key": "nope"})).status_code == 401
    assert (await client.get("/admin/stats", headers={"X-API-Key": "sup-key-0003"})).status_code == 200
    assert (await client.get("/admin/signals", headers={"X-API-Key": "sup-key-0003"})).status_code == 403
    assert (await client.post("/admin/kill-switch", json={"on": True},
                              headers={"X-API-Key": "ana-key-0002"})).status_code == 403
    r = await client.post("/admin/kill-switch", json={"on": True},
                          headers={"X-API-Key": "adm-key-0001"})
    assert r.status_code == 200 and (await client.get("/health")).json()["kill_switch"] is True


async def test_human_approval_publishes_via_outbox(client, maker):
    now = utcnow()
    c = Candidate("orb", "SPY", "long", now, 600, 599.9, 600.1, 598, 603, 606, "x", "r",
                  timedelta(minutes=20), 60, 70)
    async with maker() as s:
        x = await sig.create_candidate(s, c, "Massive", now, False)
        await sig.validate(s, x, RiskDecision(True, []), now)
        ref = x.ref
    h = {"X-API-Key": "ana-key-0002"}
    listed = (await client.get("/admin/signals?status=validated", headers=h)).json()
    assert [s["ref"] for s in listed] == [ref]
    r = await client.post(f"/admin/signals/{ref}/decision", json={"approve": True}, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "published"
    r = await client.post(f"/admin/signals/{ref}/decision", json={"approve": True}, headers=h)
    assert r.status_code == 409  # cannot approve twice
    hist = (await client.get(f"/admin/signals/{ref}/history", headers=h)).json()
    assert [e["to"] for e in hist] == ["candidate", "validated", "approved", "published"]
    assert hist[2]["actor"].startswith("admin:analyst:")
    async with maker() as s:
        msgs = (await s.scalars(select(OutboundMessage))).all()
        assert [m.chat_id for m in msgs] == [-100777]
        assert (await s.scalar(select(Signal))).published_at is not None


async def test_plan_price_update_is_audited(client):
    h = {"X-API-Key": "adm-key-0001"}
    r = await client.patch("/admin/plans/monthly", json={"price_stars": 999}, headers=h)
    assert r.json()["stars"] == 999
    log = (await client.get("/admin/audit", headers=h)).json()["items"]
    assert log[0]["action"] == "plan.updated" and log[0]["actor"].startswith("admin:admin:")
    assert (await client.patch("/admin/plans/monthly", json={"price_stars": 0},
                               headers=h)).status_code == 422


async def test_performance_separates_kinds(client):
    r = await client.get("/admin/performance?kind=backtest", headers={"X-API-Key": "ana-key-0002"})
    assert r.json()["kind"] == "backtest" and r.json()["overall"]["trades"] == 0


def test_production_safety_checks():
    s = Settings(env="prod")
    problems = s.require_production_safety()
    assert any("SIGNING_KEY" in p for p in problems)
    assert any("mock" in p for p in problems)
    assert any("PostgreSQL" in p for p in problems)


# --------------------------------------------------------------------- AI

def test_agent_permissions_least_privilege():
    assert allowed("risk_manager", Capability.VETO_SIGNAL)
    assert not allowed("assistant", Capability.SEND_MESSAGES)
    assert not allowed("assistant", Capability.PROPOSE_CANDIDATE)
    assert not allowed("geopolitical", Capability.VETO_SIGNAL)
    with pytest.raises(PermissionError):
        require("assistant", Capability.VALIDATE_SIGNAL)


def test_grounding_detects_invented_numbers():
    ev = ['{"stop": 598.0, "target1": 603.25, "as_of": "2026-03-10T15:00:00+00:00"}']
    assert ungrounded_numbers("الوقف 598 والهدف 603.25", ev) == set()
    assert ungrounded_numbers("الوقف ٥٩٨", ev) == set()  # Arabic-Indic digits normalised
    assert ungrounded_numbers("probability of success is 87%", ev) == {"87"}
    assert ungrounded_numbers("target 1,250.5", ['{"t": 1250.5}']) == set()


class _FakeMessages:
    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    async def create(self, **kw):
        self.calls.append(kw)
        return self.script.pop(0)


def _resp(stop, blocks):
    return SimpleNamespace(stop_reason=stop, content=blocks)


def _text(t):
    return SimpleNamespace(type="text", text=t)


def _tool(name, inp, id_="tu1"):
    return SimpleNamespace(type="tool_use", name=name, input=inp, id=id_)


async def _get_signal(inp):
    return {"ref": inp["ref"], "stop": 598.0, "target1": 603.0, "source": "Massive",
            "as_of": "2026-03-10T15:00:00Z"}


async def test_assistant_grounded_answer_passes():
    msgs = _FakeMessages([_resp("tool_use", [_tool("get_signal", {"ref": "UM-1"})]),
                          _resp("end_turn", [_text("وقف الخسارة 598 والهدف الأول 603 (Massive).")])])
    a = ResearchAssistant(SimpleNamespace(beta=SimpleNamespace(messages=msgs)),
                          {"get_signal": _get_signal})
    r = await a.ask("اشرح الإشارة UM-1")
    assert r.grounded and "598" in r.text and r.tool_calls == ["get_signal"]
    first = msgs.calls[0]
    assert first["model"] == "claude-opus-5-5" and first["fallbacks"] == "default"
    assert [t["name"] for t in first["tools"]] == ["get_signal"]
    tool_result = msgs.calls[1]["messages"][2]["content"][0]
    assert tool_result["type"] == "tool_result" and "598" in tool_result["content"]


async def test_assistant_withholds_hallucinated_numbers():
    msgs = _FakeMessages([_resp("tool_use", [_tool("get_signal", {"ref": "UM-1"})]),
                          _resp("end_turn", [_text("Win probability is 92% and SPX will hit 6200.")])])
    a = ResearchAssistant(SimpleNamespace(beta=SimpleNamespace(messages=msgs)),
                          {"get_signal": _get_signal})
    r = await a.ask("UM-1?", lang="en")
    assert not r.grounded and "withheld" in r.text


async def test_assistant_refusal_and_unknown_tool():
    msgs = _FakeMessages([_resp("tool_use", [_tool("delete_everything", {})]),
                          _resp("refusal", [])])
    a = ResearchAssistant(SimpleNamespace(beta=SimpleNamespace(messages=msgs)),
                          {"get_signal": _get_signal})
    r = await a.ask("x", lang="en")
    assert r.refused
    err = msgs.calls[1]["messages"][2]["content"][0]
    assert err["is_error"] is True


async def test_ai_quota(session, user):
    assert await consume_quota(session, user.id, 2) == 1
    assert await consume_quota(session, user.id, 2) == 0
    with pytest.raises(QuotaExceeded):
        await consume_quota(session, user.id, 2)
