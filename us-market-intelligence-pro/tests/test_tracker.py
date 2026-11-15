from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from umip.config import PublishMode
from umip.market_data.base import Bar
from umip.market_data.health import FeedHealth
from umip.models import OutboundMessage, ResultKind, SignalEvent, SignalStatus as S
from umip.performance.metrics import signal_performance
from umip.quant.strategies import Candidate
from umip.risk.engine import RiskDecision
from umip.signals import service as sig
from umip.signals.formatting import render_signal
from umip.signals.tracker import TrackerPolicy, net_r, track_open_signals

UTC = timezone.utc
T0 = datetime(2026, 3, 10, 15, 0, tzinfo=UTC)  # 11:00 New York (EDT)
CHAT = -100900
P = TrackerPolicy()


class ScriptedProvider:
    name = "SCRIPT"

    def __init__(self, bars: list[Bar], is_mock: bool = False):
        self._bars = bars
        self.is_mock = is_mock

    async def bars(self, symbol, timeframe, start, end):
        return [b for b in self._bars if start <= b.ts <= end]


def bar(minute: int, o: float, h: float, l: float, c: float) -> Bar:
    return Bar(T0 + timedelta(minutes=minute), o, h, l, c, 1000.0)


async def _open_signal(session, direction="long", kind=ResultKind.PUBLISHED, valid=20):
    if direction == "long":
        c = Candidate("orb", "SPY", "long", T0 - timedelta(minutes=1), 600.0, 599.9, 600.1, 598.0,
                      603.0, 606.0, "x", "test", timedelta(minutes=valid), 60, 70)
    else:
        c = Candidate("orb", "SPY", "short", T0 - timedelta(minutes=1), 600.0, 599.9, 600.1, 602.0,
                      597.0, 594.0, "x", "test", timedelta(minutes=valid), 60, 70)
    s = await sig.create_candidate(session, c, "SCRIPT", T0, False, kind=kind)
    await sig.validate(session, s, RiskDecision(True, []), T0 - timedelta(minutes=1))
    await sig.approve(session, s, "admin:analyst:1", PublishMode.HUMAN_APPROVAL)
    if kind == ResultKind.PUBLISHED:
        await sig.publish(session, s, CHAT, render_signal, "admin:analyst:1", now=T0)
    else:
        await sig.publish_paper(session, s, "admin:analyst:1", now=T0)
    return s


async def _run(session, bars, now, is_mock=False):
    return await track_open_signals(session, ScriptedProvider(bars, is_mock), FeedHealth(), CHAT, P, now=now)


async def _events(session, s):
    return [(e.to_status, e.data) for e in await sig.history(session, s)][4:]  # after publication


async def test_fill_target1_target2_with_costs_and_notifications(session):
    s = await _open_signal(session)
    bars = [bar(0, 600.5, 600.6, 600.3, 600.4),   # above zone: no fill
            bar(1, 600.2, 600.2, 599.95, 600.0),  # fills at 600.1 (open clamped to zone)
            bar(2, 600.0, 603.2, 599.5, 603.0),   # target 1
            bar(3, 603.0, 606.4, 602.5, 606.2)]   # target 2
    res = await _run(session, bars, T0 + timedelta(minutes=5))
    assert res[0].actions == ["active", "target1_hit", "target2_hit"]
    assert s.status == S.TARGET2_HIT and s.closed_at == T0 + timedelta(minutes=3)
    ev = dict(await _events(session, s))
    assert ev["active"]["entry_fill"] == 600.1
    close = ev["target2_hit"]
    gross = (606.0 - 600.1) / 2.0
    assert 0 < close["r_net"] < gross and close["exit"] == 606.0
    assert close["mfe_r"] >= 3.0 and close["mae_r"] == pytest.approx(0.3, abs=1e-3)
    keys = [m.dedup_key for m in (await session.scalars(select(OutboundMessage))).all()]
    assert keys[1:] == [f"signal:{s.ref}:active", f"signal:{s.ref}:target1_hit", f"signal:{s.ref}:target2_hit"]
    perf = await signal_performance(session, ResultKind.PUBLISHED)
    assert perf["overall"]["trades"] == 1 and perf["overall"]["total_r"] == close["r_net"]


async def test_stop_assumed_first_when_stop_and_target_in_same_bar(session):
    s = await _open_signal(session)
    bars = [bar(0, 600.0, 600.1, 599.9, 600.0), bar(1, 600.0, 603.5, 597.5, 601.0)]
    res = await _run(session, bars, T0 + timedelta(minutes=3))
    assert res[0].actions == ["active", "stopped"]
    r = dict(await _events(session, s))["stopped"]["r_net"]
    assert r == net_r("long", 600.0, 598.0, 2.0, P) and r < -1.0


async def test_breakeven_stop_after_target1(session):
    s = await _open_signal(session)
    bars = [bar(0, 600.0, 600.1, 599.9, 600.0), bar(1, 600.0, 603.1, 600.0, 602.8),
            bar(2, 602.8, 602.9, 599.8, 600.2)]
    res = await _run(session, bars, T0 + timedelta(minutes=4))
    assert res[0].actions == ["active", "target1_hit", "stopped"]
    ev = dict(await _events(session, s))
    assert ev["target1_hit"]["r_unrealized"] > 1.0
    # breakeven exit loses only costs: 2.5bps per side on 600 vs a 2.0 risk = -0.15R
    assert ev["stopped"]["r_net"] == net_r("long", 600.0, 600.0, 2.0, P) == -0.15
    assert s.tracking["stop"] == 600.0


async def test_no_fill_leaves_signal_for_expiry(session):
    s = await _open_signal(session, valid=3)
    bars = [bar(m, 601, 601.2, 600.8, 601) for m in range(6)]
    res = await _run(session, bars, T0 + timedelta(minutes=7))
    assert res[0].actions == [] and s.status == S.PUBLISHED
    assert [x.ref for x in await sig.expire_due(session, T0 + timedelta(minutes=7))] == [s.ref]
    assert s.status == S.EXPIRED


async def test_session_close_flattens_open_position(session):
    s = await _open_signal(session, valid=400)
    close = datetime(2026, 3, 10, 20, 0, tzinfo=UTC)  # 16:00 EDT
    late = int((close - T0).total_seconds() // 60)
    bars = [bar(0, 600.0, 600.1, 599.9, 600.0)] + [bar(m, 600.5, 600.9, 600.2, 600.8) for m in range(late - 6, late - 3)]
    res = await _run(session, bars, close)
    assert res[0].actions == ["active", "session_close"]
    data = dict(await _events(session, s))["cancelled"]
    assert data["exit"] == 600.8 and data["r_net"] > 0


async def test_short_signal(session):
    s = await _open_signal(session, direction="short")
    bars = [bar(0, 600.0, 600.1, 599.9, 600.0), bar(1, 600.0, 600.2, 593.8, 594.0)]
    res = await _run(session, bars, T0 + timedelta(minutes=3))
    assert res[0].actions == ["active", "target2_hit"]
    assert dict(await _events(session, s))["target2_hit"]["r_net"] > 2.5


async def test_rerun_is_idempotent(session):
    s = await _open_signal(session)
    bars = [bar(0, 600.0, 600.1, 599.9, 600.0), bar(1, 600.0, 603.1, 600.0, 602.8)]
    now = T0 + timedelta(minutes=3)
    await _run(session, bars, now)
    n_events = await session.scalar(select(func.count(SignalEvent.id)))
    n_msgs = await session.scalar(select(func.count(OutboundMessage.id)))
    res = await _run(session, bars, now)
    assert res[0].actions == []
    assert await session.scalar(select(func.count(SignalEvent.id))) == n_events
    assert await session.scalar(select(func.count(OutboundMessage.id))) == n_msgs
    assert s.status == S.TARGET1_HIT


async def test_unclosed_bar_is_ignored(session):
    s = await _open_signal(session)
    res = await _run(session, [bar(0, 600.0, 600.1, 599.9, 600.0)], T0 + timedelta(seconds=30))
    assert res[0].actions == [] and s.status == S.PUBLISHED


async def test_mock_prices_never_decide_real_signals(session):
    s = await _open_signal(session)
    res = await _run(session, [bar(0, 600.0, 600.1, 599.9, 600.0)], T0 + timedelta(minutes=2), is_mock=True)
    assert res[0].skipped and s.status == S.PUBLISHED


async def test_stale_bars_skip_and_mark_feed_unhealthy(session):
    s = await _open_signal(session)
    health = FeedHealth()
    res = await track_open_signals(session, ScriptedProvider([bar(0, 600.0, 600.1, 599.9, 600.0)]), health,
                                   CHAT, P, now=T0 + timedelta(minutes=10))
    assert res[0].skipped == "stale bars" and s.status == S.PUBLISHED
    assert not health.is_healthy("SCRIPT", T0 + timedelta(minutes=10))


async def test_paper_signal_tracked_without_messages(session):
    s = await _open_signal(session, kind=ResultKind.PAPER)
    assert s.kind == ResultKind.PAPER
    bars = [bar(0, 600.0, 600.1, 599.9, 600.0), bar(1, 600.0, 600.0, 597.9, 598.0)]
    res = await _run(session, bars, T0 + timedelta(minutes=3))
    assert res[0].actions == ["active", "stopped"]
    assert await session.scalar(select(func.count(OutboundMessage.id))) == 0
    assert (await signal_performance(session, ResultKind.PAPER))["overall"]["trades"] == 1


async def test_manually_activated_signal_uses_assumed_midpoint_entry(session):
    s = await _open_signal(session)
    await sig._transition(session, s, S.ACTIVE, "admin:analyst:1", "manual")
    await session.commit()
    res = await _run(session, [bar(0, 600.5, 600.6, 600.2, 600.4), bar(1, 600.4, 606.2, 600.3, 606.1)],
                     T0 + timedelta(minutes=3))
    assert res[0].actions == ["target2_hit"]
    assert s.tracking["entry"] == 600.0 and s.tracking["entry_assumed"] is True
