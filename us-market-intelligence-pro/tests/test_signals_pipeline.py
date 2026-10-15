from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import func, select

from tests.conftest import MARKET_NOW
from umip.config import PublishMode
from umip.flags import KILL_SWITCH, set_flag
from umip.market_data.health import FeedHealth
from umip.market_data.mock import MockProvider
from umip.models import OutboundMessage, ResultKind, SignalStatus as S
from umip.notifications import dispatch
from umip.pipeline import run_once
from umip.quant.strategies import Candidate
from umip.risk.engine import RiskDecision, RiskPolicy
from umip.signals import service as sig
from umip.signals.formatting import render_signal, render_update

CHAT = -100500


def _cand(now=MARKET_NOW, **kw):
    base = dict(strategy="orb", symbol="SPY", direction="long", detected_at=now,
                reference_price=600.0, entry_low=599.9, entry_high=600.1, stop=598.0,
                target1=603.0, target2=606.0, invalidation="close below 599",
                reason="ORB15 break", valid_for=timedelta(minutes=20), expected_hold_minutes=60,
                score=72.0)
    base.update(kw)
    return Candidate(**base)


async def _validated(session, now=MARKET_NOW, mock=False, kind=ResultKind.PUBLISHED):
    s = await sig.create_candidate(session, _cand(now), "Massive", now, mock, kind=kind)
    await sig.validate(session, s, RiskDecision(True, []), now)
    return s


async def test_lifecycle_full_path_and_history(session):
    s = await _validated(session)
    assert s.status == S.VALIDATED and s.ref.startswith("UM-260310-")
    original = dict(s.original)
    with pytest.raises(PermissionError):
        await sig.approve(session, s, "engine", PublishMode.HUMAN_APPROVAL)
    await sig.approve(session, s, "admin:analyst:1234", PublishMode.HUMAN_APPROVAL)
    assert await sig.publish(session, s, CHAT, render_signal, "admin:analyst:1234",
                             now=MARKET_NOW + timedelta(minutes=1))
    await sig.update_status(session, s, S.ACTIVE, "tracker", CHAT, render_update)
    await sig.update_status(session, s, S.TARGET1_HIT, "tracker", CHAT, render_update,
                            data={"r_net": 1.4})
    with pytest.raises(sig.TransitionError):
        await sig.update_status(session, s, S.ACTIVE, "tracker", CHAT, render_update)
    assert s.original == original  # never rewritten
    hist = [(e.from_status, e.to_status) for e in await sig.history(session, s)]
    assert hist == [(None, "candidate"), ("candidate", "validated"), ("validated", "approved"),
                    ("approved", "published"), ("published", "active"), ("active", "target1_hit")]
    keys = [m.dedup_key for m in (await session.scalars(select(OutboundMessage))).all()]
    assert keys == [f"signal:{s.ref}:published", f"signal:{s.ref}:active",
                    f"signal:{s.ref}:target1_hit"]


async def test_stale_signal_is_expired_not_published(session):
    s = await _validated(session)
    await sig.approve(session, s, "admin:a:1", PublishMode.HUMAN_APPROVAL)
    ok = await sig.publish(session, s, CHAT, render_signal, "admin:a:1",
                           now=MARKET_NOW + timedelta(minutes=30))
    assert not ok and s.status == S.EXPIRED
    assert await session.scalar(select(func.count(OutboundMessage.id))) == 0


async def test_kill_switch_blocks_publication(session):
    s = await _validated(session)
    await sig.approve(session, s, "admin:a:1", PublishMode.HUMAN_APPROVAL)
    await set_flag(session, KILL_SWITCH, True, "admin:a:1")
    with pytest.raises(PermissionError):
        await sig.publish(session, s, CHAT, render_signal, "admin:a:1", now=MARKET_NOW)


async def test_mock_data_signal_never_published_to_subscribers(session):
    s = await _validated(session, mock=True)
    await sig.approve(session, s, "admin:a:1", PublishMode.HUMAN_APPROVAL)
    with pytest.raises(PermissionError, match="mock"):
        await sig.publish(session, s, CHAT, render_signal, "admin:a:1", now=MARKET_NOW)


async def test_expire_due_marks_unentered_signals_expired(session):
    s = await _validated(session)
    expired = await sig.expire_due(session, MARKET_NOW + timedelta(hours=1))
    assert [x.ref for x in expired] == [s.ref] and s.status == S.EXPIRED


async def test_rejected_by_risk(session):
    s = await sig.create_candidate(session, _cand(), "Massive", MARKET_NOW, False)
    await sig.validate(session, s, RiskDecision(False, ["kill switch active"]), MARKET_NOW)
    assert s.status == S.REJECTED


def test_message_contains_required_fields():
    from umip.models import Signal
    s = Signal(ref="UM-1", status=S.PUBLISHED, strategy="orb", symbol="SPY", direction="long",
               score=72, is_mock_data=False, valid_until=MARKET_NOW + timedelta(minutes=20),
               original={"reference_price": 600.0, "entry_low": 599.9, "entry_high": 600.1,
                         "target1": 603, "target2": 606, "stop": 598, "reward_risk": 1.5,
                         "invalidation": "x<y", "reason": "r", "detected_at": MARKET_NOW.isoformat(),
                         "data_source": "Massive", "data_as_of": MARKET_NOW.isoformat(),
                         "option": None})
    text = render_signal(s)["text"]
    for needle in ("UM-1", "SPY", "603.00", "598.00", "EDT", "Riyadh", "Massive",
                   "WAITING FOR ENTRY", "x&lt;y", "ليس نصيحة"):
        assert needle in text


async def test_outbox_dedup_retry_and_dead_letter(session):
    from umip.notifications import enqueue
    assert await enqueue(session, "k1", 1, {"text": "a"})
    await session.commit()
    assert not await enqueue(session, "k1", 1, {"text": "a"})

    class Flaky:
        def __init__(self):
            self.calls = 0

        async def send(self, chat_id, payload):
            self.calls += 1
            raise RuntimeError("telegram 502")

    f = Flaky()
    for _ in range(5):
        await dispatch(session, f, max_attempts=3)
    m = await session.scalar(select(OutboundMessage))
    assert m.status == "dead" and m.attempts == 3 and f.calls == 3

    class Ok:
        sent = []

        async def send(self, chat_id, payload):
            self.sent.append(payload)

    await enqueue(session, "k2", 1, {"text": "b"})
    await session.commit()
    ok = Ok()
    await dispatch(session, ok)
    await dispatch(session, ok)  # restart: nothing re-sent
    assert ok.sent == [{"text": "b"}]


# ---------------------------------------------------------------- pipeline

async def test_pipeline_blocks_on_stale_data(session):
    provider = MockProvider(now_fn=lambda: MARKET_NOW, age_seconds=120)
    from umip.quant.strategies import OpeningRangeBreakout
    health = FeedHealth()
    r = await run_once(session, provider, OpeningRangeBreakout(), "SPY", policy=RiskPolicy(),
                       options_policy=None, health=health, max_quote_age=timedelta(seconds=15),
                       publish_mode=PublishMode.HUMAN_APPROVAL, now=MARKET_NOW, allow_mock=True)
    assert r.outcome == "data_blocked" and "stale" in r.reasons[0]


class _AlwaysLong:
    name = "orb"
    timeframe = "5m"

    def evaluate(self, symbol, bars):
        last = bars[-1]
        now = last.ts + timedelta(minutes=5)
        return _cand(now=now, symbol=symbol, reference_price=last.close,
                     entry_low=last.close - 0.1, entry_high=last.close + 0.1,
                     stop=last.close - 2, target1=last.close + 4, target2=last.close + 8)


async def test_pipeline_mock_rejected_in_production_mode(session):
    provider = MockProvider(now_fn=lambda: MARKET_NOW)
    r = await run_once(session, provider, _AlwaysLong(), "SPY",
                       policy=RiskPolicy(enabled_strategies=frozenset({"orb"})),
                       options_policy=None, health=FeedHealth(),
                       max_quote_age=timedelta(seconds=15),
                       publish_mode=PublishMode.HUMAN_APPROVAL, now=MARKET_NOW, allow_mock=False)
    assert r.outcome == "rejected" and any("mock" in v for v in r.reasons)


async def test_pipeline_paper_mode_with_options_awaits_human(session):
    provider = MockProvider(now_fn=lambda: MARKET_NOW)
    from umip.options.selector import OptionsPolicy
    r = await run_once(session, provider, _AlwaysLong(), "SPY",
                       policy=RiskPolicy(enabled_strategies=frozenset({"orb"}), zero_dte_enabled=True),
                       options_policy=OptionsPolicy(min_reward_risk=1.0, max_spread_pct=0.2),
                       health=FeedHealth(), max_quote_age=timedelta(seconds=15),
                       publish_mode=PublishMode.HUMAN_APPROVAL, now=MARKET_NOW, allow_mock=True,
                       kind=ResultKind.PAPER)
    assert r.outcome == "validated", r.reasons
    from umip.models import Signal
    s = await session.scalar(select(Signal).where(Signal.ref == r.signal_ref))
    assert s.is_mock_data and s.kind == ResultKind.PAPER
    assert s.original["option"]["right"] == "C" and s.original["data_source"] == "MOCK"


async def test_pipeline_no_setup(session):
    class Never:
        name, timeframe = "orb", "5m"

        def evaluate(self, symbol, bars):
            return None

    r = await run_once(session, MockProvider(now_fn=lambda: MARKET_NOW), Never(), "QQQ",
                       policy=RiskPolicy(), options_policy=None, health=FeedHealth(),
                       max_quote_age=timedelta(seconds=15),
                       publish_mode=PublishMode.HUMAN_APPROVAL, now=MARKET_NOW)
    assert r.outcome == "no_setup"


async def test_feed_health_trips_after_failures():
    h = FeedHealth(failure_threshold=2)
    h.ok("X", MARKET_NOW)
    assert h.is_healthy("X", MARKET_NOW)
    h.fail("X")
    h.fail("X")
    assert not h.is_healthy("X", MARKET_NOW)
    h.ok("X", MARKET_NOW)
    assert not h.is_healthy("X", MARKET_NOW + timedelta(minutes=5))  # heartbeat timeout



async def test_pipeline_rejects_when_live_price_moved_away(session):
    class FarAway(_AlwaysLong):
        def evaluate(self, symbol, bars):
            c = super().evaluate(symbol, bars)
            return Candidate(**{**c.__dict__, "reference_price": c.reference_price * 1.01})

    r = await run_once(session, MockProvider(now_fn=lambda: MARKET_NOW), FarAway(), "SPY",
                       policy=RiskPolicy(enabled_strategies=frozenset({"orb"})),
                       options_policy=None, health=FeedHealth(),
                       max_quote_age=timedelta(seconds=15),
                       publish_mode=PublishMode.HUMAN_APPROVAL, now=MARKET_NOW, allow_mock=True)
    assert r.outcome == "rejected" and "drifted" in r.reasons[0]
