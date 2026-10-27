"""Signal lifecycle.

Candidate → Validated → Approved → Published → Active →
Target1/Target2 / Stopped / Expired / Cancelled  (Rejected from early states).

- ``Signal.original`` is written once, at creation, and never modified.
- Every transition appends a ``SignalEvent``.
- Publication and updates enqueue outbox messages with dedup keys.
"""

from __future__ import annotations

import secrets
from dataclasses import asdict
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from umip.audit import audit
from umip.config import PublishMode
from umip.flags import kill_switch_on
from umip.models import ResultKind, Signal, SignalEvent, SignalStatus as S
from umip.notifications import enqueue
from umip.options.selector import ContractEval
from umip.quant.strategies import Candidate
from umip.risk.engine import RiskDecision
from umip.timeutil import ensure_utc, utcnow

TRANSITIONS: dict[S, set[S]] = {
    S.CANDIDATE: {S.VALIDATED, S.REJECTED, S.CANCELLED},
    S.VALIDATED: {S.APPROVED, S.REJECTED, S.CANCELLED, S.EXPIRED},
    S.APPROVED: {S.PUBLISHED, S.CANCELLED, S.EXPIRED},
    S.PUBLISHED: {S.ACTIVE, S.EXPIRED, S.CANCELLED},
    S.ACTIVE: {S.TARGET1_HIT, S.TARGET2_HIT, S.STOPPED, S.CANCELLED},
    S.TARGET1_HIT: {S.TARGET2_HIT, S.STOPPED, S.CANCELLED},
}
TERMINAL = {S.TARGET2_HIT, S.STOPPED, S.EXPIRED, S.CANCELLED, S.REJECTED}
OPEN_STATES = {S.PUBLISHED, S.ACTIVE, S.TARGET1_HIT}


class TransitionError(ValueError):
    pass


def new_ref(now: datetime) -> str:
    return f"UM-{now:%y%m%d}-{secrets.token_hex(3).upper()}"


async def _transition(session: AsyncSession, sig: Signal, to: S, actor: str,
                      note: str | None = None, data: dict | None = None) -> None:
    if to not in TRANSITIONS.get(sig.status, set()):
        raise TransitionError(f"{sig.ref}: {sig.status} -> {to} not allowed")
    session.add(SignalEvent(signal_id=sig.id, from_status=sig.status.value, to_status=to.value,
                            actor=actor, note=note, data=data))
    sig.status = to
    if to in TERMINAL:
        sig.closed_at = utcnow()


async def create_candidate(session: AsyncSession, c: Candidate, data_source: str,
                           data_as_of: datetime, is_mock: bool,
                           option: ContractEval | None = None,
                           kind: ResultKind = ResultKind.PUBLISHED,
                           created_by: str = "engine") -> Signal:
    snap = {k: (v.isoformat() if isinstance(v, datetime) else
                v.total_seconds() if hasattr(v, "total_seconds") else v)
            for k, v in asdict(c).items()}
    snap.update({"reward_risk": round(c.reward_risk, 2), "data_source": data_source,
                 "data_as_of": ensure_utc(data_as_of).isoformat(), "is_mock": is_mock,
                 "option": option.summary() if option else None})
    sig = Signal(ref=new_ref(c.detected_at), status=S.CANDIDATE, kind=kind, strategy=c.strategy,
                 symbol=c.symbol, direction=c.direction, original=snap, score=c.score,
                 detected_at=c.detected_at, valid_until=c.detected_at + c.valid_for,
                 is_mock_data=is_mock, created_by=created_by)
    session.add(sig)
    await session.flush()
    session.add(SignalEvent(signal_id=sig.id, from_status=None, to_status=S.CANDIDATE.value,
                            actor=created_by, data={"score": c.score}))
    await session.commit()
    return sig


async def validate(session: AsyncSession, sig: Signal, decision: RiskDecision,
                   now: datetime | None = None) -> Signal:
    now = now or utcnow()
    if ensure_utc(sig.valid_until) <= now:
        await _transition(session, sig, S.REJECTED, "validator", "stale before validation")
    elif decision.approved:
        await _transition(session, sig, S.VALIDATED, "risk_engine")
    else:
        await _transition(session, sig, S.REJECTED, "risk_engine", "; ".join(decision.violations),
                          {"violations": decision.violations})
    await session.commit()
    return sig


async def approve(session: AsyncSession, sig: Signal, actor: str, mode: PublishMode) -> Signal:
    if mode == PublishMode.HUMAN_APPROVAL and not actor.startswith("admin:"):
        raise PermissionError("human approval required")
    await _transition(session, sig, S.APPROVED, actor)
    await audit(session, actor, "signal.approved", sig.ref)
    await session.commit()
    return sig


async def reject(session: AsyncSession, sig: Signal, actor: str, reason: str) -> Signal:
    await _transition(session, sig, S.REJECTED, actor, reason)
    await audit(session, actor, "signal.rejected", sig.ref, reason=reason)
    await session.commit()
    return sig


async def publish(session: AsyncSession, sig: Signal, chat_id: int, render, actor: str,
                  now: datetime | None = None) -> bool:
    """Enqueue the publication. Refuses stale signals and respects the kill switch."""
    now = now or utcnow()
    if await kill_switch_on(session):
        raise PermissionError("kill switch active")
    if ensure_utc(sig.valid_until) <= now:
        await _transition(session, sig, S.EXPIRED, "publisher", "expired before publication")
        await session.commit()
        return False
    if sig.is_mock_data and sig.kind == ResultKind.PUBLISHED:
        raise PermissionError("mock-data signal cannot be published to subscribers")
    await _transition(session, sig, S.PUBLISHED, actor)
    sig.published_at = now
    await enqueue(session, f"signal:{sig.ref}:published", chat_id, render(sig))
    await audit(session, actor, "signal.published", sig.ref)
    await session.commit()
    return True


async def publish_paper(session: AsyncSession, sig: Signal, actor: str,
                        now: datetime | None = None) -> bool:
    """Paper/backtest signals are tracked like published ones but never sent to subscribers."""
    now = now or utcnow()
    if sig.kind == ResultKind.PUBLISHED:
        raise PermissionError("subscriber signals must go through publish()")
    if ensure_utc(sig.valid_until) <= now:
        await _transition(session, sig, S.EXPIRED, "publisher", "expired before publication")
        await session.commit()
        return False
    await _transition(session, sig, S.PUBLISHED, actor, "paper: not sent to subscribers")
    sig.published_at = now
    await session.commit()
    return True


async def update_status(session: AsyncSession, sig: Signal, to: S, actor: str, chat_id: int,
                        render_update, note: str | None = None, data: dict | None = None) -> None:
    await _transition(session, sig, to, actor, note, data)
    await enqueue(session, f"signal:{sig.ref}:{to.value}", chat_id,
                  render_update(sig, to, note))
    await session.commit()


async def expire_due(session: AsyncSession, now: datetime | None = None) -> list[Signal]:
    """Signals never entered before ``valid_until`` become EXPIRED (not win/loss)."""
    now = now or utcnow()
    q = select(Signal).where(Signal.status.in_((S.VALIDATED, S.APPROVED, S.PUBLISHED)))
    out = []
    for sig in (await session.scalars(q)).all():
        if ensure_utc(sig.valid_until) <= now:
            await _transition(session, sig, S.EXPIRED, "system", "not entered in time")
            out.append(sig)
    await session.commit()
    return out


async def history(session: AsyncSession, sig: Signal) -> list[SignalEvent]:
    q = select(SignalEvent).where(SignalEvent.signal_id == sig.id).order_by(SignalEvent.id)
    return list((await session.scalars(q)).all())
