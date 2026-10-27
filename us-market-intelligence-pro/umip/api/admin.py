"""Admin API consumed by the web dashboard (and usable directly).

Every mutating endpoint is role-gated and audited. Money and signal history are
never edited in place: refunds append ledger entries, signal changes append
events.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select

from umip.audit import audit
from umip.api.security import require_role
from umip.config import PublishMode
from umip.flags import DISABLED_STRATEGIES, KILL_SWITCH, PUBLISH_MODE, get_flag, set_flag
from umip.models import (
    AuditLog, ChannelMember, Coupon, OutboundMessage, Payment, PaymentStatus, Plan, ResultKind,
    Signal, SignalStatus, Subscription, User,
)
from umip.payments import service as pay
from umip.performance.metrics import business_metrics, signal_performance
from umip.quant.strategies import REGISTRY, Candidate
from umip.risk.engine import RiskDecision, RiskPolicy
from umip.signals import service as sigsvc
from umip.signals.formatting import render_signal, render_update
from umip.subscriptions.service import ENTITLED, entitlement_end, get_plan, grant_period
from umip.timeutil import utcnow

router = APIRouter(prefix="/admin", tags=["admin"])

SUPPORT = require_role("support")
ANALYST = require_role("analyst")
ADMIN = require_role("admin")


def _maker(request: Request):
    return request.app.state.maker


def _settings(request: Request):
    return request.app.state.settings


async def effective_publish_mode(session, settings) -> PublishMode:
    override = await get_flag(session, PUBLISH_MODE, None)
    return PublishMode(override) if override else settings.publish_mode


def _page(total: int, items: list, limit: int, offset: int) -> dict:
    return {"total": total, "limit": limit, "offset": offset, "items": items}


# ------------------------------------------------------------------ identity

@router.get("/me")
async def me(actor: str = SUPPORT) -> dict:
    _, role, key_tail = actor.split(":")
    return {"actor": actor, "role": role, "key_hint": f"…{key_tail}"}


# ------------------------------------------------------------------ overview

@router.get("/stats")
async def stats(request: Request, actor: str = SUPPORT) -> dict:
    async with _maker(request)() as s:
        return await business_metrics(s, utcnow())


@router.get("/overview")
async def overview(request: Request, actor: str = SUPPORT) -> dict:
    settings = _settings(request)
    now = utcnow()
    async with _maker(request)() as s:
        biz = await business_metrics(s, now)
        counts = dict((k.value, v) for k, v in (await s.execute(
            select(Signal.status, func.count(Signal.id)).where(Signal.kind != ResultKind.BACKTEST)
            .group_by(Signal.status))).all())
        pending_review = await s.scalar(select(func.count(Signal.id)).where(
            Signal.status == SignalStatus.VALIDATED)) or 0
        dead = await s.scalar(select(func.count(OutboundMessage.id)).where(
            OutboundMessage.status == "dead")) or 0
        ks = bool(await get_flag(s, KILL_SWITCH, False))
        mode = await effective_publish_mode(s, settings)
        expiring = await s.scalar(select(func.count(func.distinct(Subscription.user_id))).where(
            Subscription.status.in_(ENTITLED), Subscription.ends_at > now,
            Subscription.ends_at <= now + timedelta(days=3))) or 0
    alerts = []
    if ks:
        alerts.append({"level": "critical", "code": "kill_switch"})
    if dead:
        alerts.append({"level": "warning", "code": "dead_letters", "count": dead})
    for p in settings.require_production_safety():
        alerts.append({"level": "critical", "code": "safety", "detail": p})
    if settings.market_data_provider == "mock":
        alerts.append({"level": "info", "code": "mock_data"})
    if pending_review:
        alerts.append({"level": "info", "code": "pending_review", "count": pending_review})
    return {"business": biz, "signals": {"by_status": counts, "pending_review": pending_review},
            "expiring_3d": expiring, "kill_switch": ks, "publish_mode": mode.value,
            "alerts": alerts, "generated_at": now.isoformat()}


# --------------------------------------------------------------------- users

def _user_row(u: User, end, paid_total: int) -> dict:
    return {"id": u.id, "telegram_id": u.telegram_id, "username": u.username,
            "language": u.language, "role": u.role.value, "is_blocked": u.is_blocked,
            "created_at": u.created_at, "last_seen_at": u.last_seen_at,
            "accepted_terms": u.accepted_terms_at is not None,
            "access_until": end, "paid_total": paid_total}


@router.get("/users")
async def list_users(request: Request, q: str | None = None,
                     status: Literal["all", "active", "inactive", "blocked"] = "all",
                     limit: int = Query(25, ge=1, le=200), offset: int = Query(0, ge=0),
                     actor: str = SUPPORT) -> dict:
    now = utcnow()
    async with _maker(request)() as s:
        query = select(User).order_by(User.id.desc())
        if q:
            like = f"%{q.strip().lstrip('@')}%"
            conds = [User.username.ilike(like)]
            if q.strip().isdigit():
                conds += [User.telegram_id == int(q.strip()), User.id == int(q.strip())]
            query = query.where(or_(*conds))
        if status == "blocked":
            query = query.where(User.is_blocked.is_(True))
        active_ids = set((await s.scalars(select(Subscription.user_id).where(
            Subscription.status.in_(ENTITLED), Subscription.starts_at <= now,
            Subscription.ends_at > now))).all())
        if status == "active":
            query = query.where(User.id.in_(active_ids or {-1}))
        elif status == "inactive":
            query = query.where(User.id.not_in(active_ids or {-1}))
        total = await s.scalar(select(func.count()).select_from(query.subquery())) or 0
        users = (await s.scalars(query.limit(limit).offset(offset))).all()
        paid = dict((await s.execute(select(Payment.user_id, func.sum(Payment.amount_minor)).where(
            Payment.status == PaymentStatus.PAID, Payment.user_id.in_([u.id for u in users] or [-1]))
            .group_by(Payment.user_id))).all())
        items = [_user_row(u, await entitlement_end(s, u.id, now), paid.get(u.id, 0)) for u in users]
    return _page(total, items, limit, offset)


@router.get("/users/{user_id}")
async def user_detail(request: Request, user_id: int, actor: str = SUPPORT) -> dict:
    async with _maker(request)() as s:
        u = await s.get(User, user_id)
        if u is None:
            raise HTTPException(404, "user not found")
        subs = (await s.scalars(select(Subscription).where(Subscription.user_id == u.id)
                                .order_by(Subscription.starts_at.desc()))).all()
        pays = (await s.scalars(select(Payment).where(Payment.user_id == u.id)
                                .order_by(Payment.id.desc()))).all()
        members = (await s.scalars(select(ChannelMember).where(ChannelMember.user_id == u.id))).all()
        paid_total = sum(p.amount_minor for p in pays if p.status == PaymentStatus.PAID)
        return {**_user_row(u, await entitlement_end(s, u.id), paid_total),
                "subscriptions": [{"id": x.id, "plan": x.plan.code, "starts_at": x.starts_at,
                                   "ends_at": x.ends_at, "status": x.status.value,
                                   "auto_renew": x.auto_renew, "payment_id": x.payment_id}
                                  for x in subs],
                "payments": [_payment_row(p) for p in pays],
                "channels": [{"chat_id": m.chat_id, "is_member": m.is_member,
                              "joined_at": m.joined_at, "removed_at": m.removed_at}
                             for m in members]}


class BlockBody(BaseModel):
    blocked: bool
    reason: str = Field(min_length=3, max_length=300)


@router.post("/users/{user_id}/block")
async def block_user(request: Request, user_id: int, b: BlockBody, actor: str = ADMIN) -> dict:
    async with _maker(request)() as s:
        u = await s.get(User, user_id)
        if u is None:
            raise HTTPException(404, "user not found")
        u.is_blocked = b.blocked
        await audit(s, actor, "user.blocked" if b.blocked else "user.unblocked", f"user:{u.id}",
                    reason=b.reason)
        await s.commit()
        return {"id": u.id, "is_blocked": u.is_blocked}


class GrantBody(BaseModel):
    plan_code: str
    reason: str = Field(min_length=3, max_length=300)


@router.post("/users/{user_id}/grant")
async def grant_access(request: Request, user_id: int, g: GrantBody, actor: str = ADMIN) -> dict:
    """Complimentary access (no payment). Audited with the reason."""
    async with _maker(request)() as s:
        u = await s.get(User, user_id)
        plan = await get_plan(s, g.plan_code)
        if u is None or plan is None:
            raise HTTPException(404, "user or plan not found")
        grant = await grant_period(s, u, plan, None, actor)
        await audit(s, actor, "subscription.comp_granted", f"user:{u.id}", plan=plan.code,
                    reason=g.reason)
        await s.commit()
        return {"starts_at": grant.starts_at, "ends_at": grant.ends_at}


# ------------------------------------------------------------------- signals

def _signal_row(x: Signal) -> dict:
    return {"ref": x.ref, "status": x.status.value, "symbol": x.symbol, "strategy": x.strategy,
            "direction": x.direction, "score": x.score, "kind": x.kind.value,
            "is_mock": x.is_mock_data, "detected_at": x.detected_at, "published_at": x.published_at,
            "valid_until": x.valid_until, "closed_at": x.closed_at, "created_by": x.created_by,
            "original": x.original}


@router.get("/signals")
async def list_signals(request: Request, status: SignalStatus | None = None,
                       kind: ResultKind | None = None, symbol: str | None = None,
                       limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0),
                       actor: str = ANALYST) -> list[dict]:
    async with _maker(request)() as s:
        q = select(Signal).order_by(Signal.id.desc())
        if status:
            q = q.where(Signal.status == status)
        if kind:
            q = q.where(Signal.kind == kind)
        if symbol:
            q = q.where(Signal.symbol == symbol.upper())
        return [_signal_row(x) for x in (await s.scalars(q.limit(limit).offset(offset))).all()]


async def _get_signal(s, ref: str) -> Signal:
    sig = await s.scalar(select(Signal).where(Signal.ref == ref))
    if sig is None:
        raise HTTPException(404, "signal not found")
    return sig


@router.get("/signals/{ref}")
async def signal_detail(request: Request, ref: str, actor: str = ANALYST) -> dict:
    async with _maker(request)() as s:
        sig = await _get_signal(s, ref)
        hist = [{"from": e.from_status, "to": e.to_status, "actor": e.actor, "note": e.note,
                 "data": e.data, "at": e.created_at} for e in await sigsvc.history(s, sig)]
        return {**_signal_row(sig), "history": hist,
                "allowed_transitions": sorted(t.value for t in sigsvc.TRANSITIONS.get(sig.status, ()))}


@router.get("/signals/{ref}/history")
async def signal_history(request: Request, ref: str, actor: str = ANALYST) -> list[dict]:
    return (await signal_detail(request, ref, actor))["history"]


class ManualSignal(BaseModel):
    symbol: str = Field(min_length=1, max_length=10, pattern=r"^[A-Za-z.]+$")
    direction: Literal["long", "short"]
    entry_low: float = Field(gt=0)
    entry_high: float = Field(gt=0)
    stop: float = Field(gt=0)
    target1: float = Field(gt=0)
    target2: float = Field(gt=0)
    invalidation: str = Field(min_length=3, max_length=300)
    reason: str = Field(min_length=10, max_length=1000)
    valid_minutes: int = Field(ge=5, le=60 * 24 * 5)
    score: float = Field(ge=0, le=100, default=60)
    kind: Literal["published", "paper"] = "published"

    @field_validator("symbol")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.upper()


def geometry_errors(m: ManualSignal) -> list[str]:
    errs = []
    if m.entry_low > m.entry_high:
        errs.append("entry_low must be ≤ entry_high")
    if m.direction == "long":
        if not m.stop < m.entry_low:
            errs.append("long: stop must be below the entry zone")
        if not m.entry_high < m.target1 <= m.target2:
            errs.append("long: targets must be above entry and target1 ≤ target2")
    else:
        if not m.stop > m.entry_high:
            errs.append("short: stop must be above the entry zone")
        if not m.target2 <= m.target1 < m.entry_low:
            errs.append("short: targets must be below entry and target2 ≤ target1")
    return errs


@router.post("/signals", status_code=201)
async def create_manual_signal(request: Request, m: ManualSignal, actor: str = ANALYST) -> dict:
    """Manual signals enter as VALIDATED and still require an approval decision."""
    errs = geometry_errors(m)
    if errs:
        raise HTTPException(422, errs)
    now = utcnow()
    mid = (m.entry_low + m.entry_high) / 2
    c = Candidate("manual", m.symbol, m.direction, now, mid, m.entry_low, m.entry_high, m.stop,
                  m.target1, m.target2, m.invalidation, m.reason,
                  timedelta(minutes=m.valid_minutes), 60, m.score)
    min_rr = RiskPolicy().min_reward_risk
    if c.reward_risk < min_rr:
        raise HTTPException(422, [f"reward/risk {c.reward_risk:.2f} below policy minimum {min_rr}"])
    async with _maker(request)() as s:
        if await get_flag(s, KILL_SWITCH, False):
            raise HTTPException(409, "kill switch active")
        sig = await sigsvc.create_candidate(s, c, f"manual ({actor})", now, False,
                                            kind=ResultKind(m.kind), created_by=actor)
        await sigsvc.validate(s, sig, RiskDecision(True, []), now)
        await audit(s, actor, "signal.manual_created", sig.ref, symbol=m.symbol)
        await s.commit()
        return _signal_row(sig)


class Decision(BaseModel):
    approve: bool
    reason: str = Field(default="", max_length=500)
    publish: bool = True


@router.post("/signals/{ref}/decision")
async def decide(request: Request, ref: str, d: Decision, actor: str = ANALYST) -> dict:
    settings = _settings(request)
    async with _maker(request)() as s:
        sig = await _get_signal(s, ref)
        try:
            if not d.approve:
                await sigsvc.reject(s, sig, actor, d.reason or "rejected by reviewer")
                return {"status": sig.status.value}
            mode = await effective_publish_mode(s, settings)
            await sigsvc.approve(s, sig, actor, mode)
            if d.publish and sig.kind != ResultKind.PUBLISHED:
                await sigsvc.publish_paper(s, sig, actor)
            elif d.publish:
                if not settings.private_channel_id:
                    raise HTTPException(409, "private channel not configured")
                await sigsvc.publish(s, sig, settings.private_channel_id, render_signal, actor)
        except sigsvc.TransitionError as e:
            raise HTTPException(409, str(e)) from e
        except PermissionError as e:
            raise HTTPException(409, str(e)) from e
        return {"status": sig.status.value}


class StatusUpdate(BaseModel):
    to: Literal["active", "target1_hit", "target2_hit", "stopped", "cancelled"]
    r_net: float | None = Field(default=None, ge=-20, le=50)
    note: str = Field(default="", max_length=500)


@router.post("/signals/{ref}/status")
async def update_signal_status(request: Request, ref: str, u: StatusUpdate,
                               actor: str = ANALYST) -> dict:
    """Record tracking outcomes. Closing states need the net R so performance stays honest."""
    settings = _settings(request)
    to = SignalStatus(u.to)
    async with _maker(request)() as s:
        sig = await _get_signal(s, ref)
        entered = sig.status in (SignalStatus.ACTIVE, SignalStatus.TARGET1_HIT)
        if to in (SignalStatus.TARGET2_HIT, SignalStatus.STOPPED) and u.r_net is None:
            raise HTTPException(422, "r_net is required to close a trade")
        if to == SignalStatus.CANCELLED and entered and u.r_net is None:
            raise HTTPException(422, "r_net is required to cancel an entered trade")
        data = {"r_net": u.r_net} if u.r_net is not None else None
        try:
            if sig.status in sigsvc.OPEN_STATES and settings.private_channel_id \
                    and sig.kind == ResultKind.PUBLISHED:
                await sigsvc.update_status(s, sig, to, actor, settings.private_channel_id,
                                           render_update, u.note or None, data)
            else:
                await sigsvc._transition(s, sig, to, actor, u.note or None, data)
                await s.commit()
        except sigsvc.TransitionError as e:
            raise HTTPException(409, str(e)) from e
        await audit(s, actor, f"signal.{to.value}", sig.ref, r_net=u.r_net)
        await s.commit()
        return {"status": sig.status.value}


# ------------------------------------------------------------- performance

@router.get("/performance")
async def performance(request: Request, kind: ResultKind = ResultKind.PUBLISHED,
                      actor: str = ANALYST) -> dict:
    async with _maker(request)() as s:
        return await signal_performance(s, kind)


# ---------------------------------------------------------- plans & coupons

def _plan_row(p: Plan) -> dict:
    return {"code": p.code, "name_ar": p.name_ar, "name_en": p.name_en, "days": p.duration_days,
            "stars": p.price_stars, "recurring": p.recurring, "is_trial": p.is_trial,
            "active": p.active, "tier": p.tier, "ai_daily_quota": p.ai_daily_quota}


@router.get("/plans")
async def plans(request: Request, actor: str = ADMIN) -> list[dict]:
    async with _maker(request)() as s:
        return [_plan_row(p) for p in (await s.scalars(select(Plan).order_by(Plan.duration_days))).all()]


class PlanUpdate(BaseModel):
    price_stars: int | None = Field(default=None, ge=1, le=100000)
    active: bool | None = None
    name_ar: str | None = Field(default=None, min_length=2, max_length=64)
    name_en: str | None = Field(default=None, min_length=2, max_length=64)
    ai_daily_quota: int | None = Field(default=None, ge=0, le=1000)


@router.patch("/plans/{code}")
async def update_plan(request: Request, code: str, u: PlanUpdate, actor: str = ADMIN) -> dict:
    async with _maker(request)() as s:
        p = await s.scalar(select(Plan).where(Plan.code == code))
        if p is None:
            raise HTTPException(404, "plan not found")
        changes = u.model_dump(exclude_none=True)
        if p.is_trial and "price_stars" in changes:
            raise HTTPException(422, "trial plans are free")
        if p.recurring and changes.get("price_stars", 0) > pay.STARS_SUBSCRIPTION_MAX:
            raise HTTPException(422, f"recurring Stars price cannot exceed {pay.STARS_SUBSCRIPTION_MAX}")
        before = {k: getattr(p, k) for k in changes}
        for k, v in changes.items():
            setattr(p, k, v)
        await audit(s, actor, "plan.updated", code, before=before, after=changes)
        await s.commit()
        return _plan_row(p)


def _coupon_row(c: Coupon) -> dict:
    return {"code": c.code, "percent_off": c.percent_off, "max_redemptions": c.max_redemptions,
            "redemptions": c.redemptions, "valid_until": c.valid_until, "plan_codes": c.plan_codes,
            "active": c.active}


@router.get("/coupons")
async def coupons(request: Request, actor: str = ADMIN) -> list[dict]:
    async with _maker(request)() as s:
        return [_coupon_row(c) for c in (await s.scalars(select(Coupon).order_by(Coupon.id.desc()))).all()]


class CouponCreate(BaseModel):
    code: str = Field(min_length=3, max_length=32, pattern=r"^[A-Za-z0-9_-]+$")
    percent_off: int = Field(ge=1, le=99)
    max_redemptions: int | None = Field(default=None, ge=1)
    valid_until: datetime | None = None
    plan_codes: list[str] | None = None


@router.post("/coupons", status_code=201)
async def create_coupon(request: Request, c: CouponCreate, actor: str = ADMIN) -> dict:
    async with _maker(request)() as s:
        code = c.code.upper()
        if await s.scalar(select(Coupon.id).where(Coupon.code == code)):
            raise HTTPException(409, "coupon code already exists")
        row = Coupon(code=code, percent_off=c.percent_off, max_redemptions=c.max_redemptions,
                     valid_until=c.valid_until, plan_codes=c.plan_codes or None)
        s.add(row)
        await audit(s, actor, "coupon.created", code, percent_off=c.percent_off)
        await s.commit()
        return _coupon_row(row)


class CouponUpdate(BaseModel):
    active: bool


@router.patch("/coupons/{code}")
async def update_coupon(request: Request, code: str, u: CouponUpdate, actor: str = ADMIN) -> dict:
    async with _maker(request)() as s:
        c = await s.scalar(select(Coupon).where(Coupon.code == code.upper()))
        if c is None:
            raise HTTPException(404, "coupon not found")
        c.active = u.active
        await audit(s, actor, "coupon.updated", c.code, active=u.active)
        await s.commit()
        return _coupon_row(c)


# ----------------------------------------------------------------- payments

def _payment_row(p: Payment) -> dict:
    return {"id": p.id, "user_id": p.user_id, "plan_id": p.plan_id, "amount": p.amount_minor,
            "currency": p.currency, "status": p.status.value, "provider": p.provider,
            "coupon_code": p.coupon_code, "is_recurring": p.is_recurring,
            "created_at": p.created_at, "paid_at": p.paid_at, "refunded_at": p.refunded_at,
            "charge_id": p.provider_charge_id}


@router.get("/payments")
async def payments(request: Request, status: PaymentStatus | None = None,
                   user_id: int | None = None, limit: int = Query(50, ge=1, le=500),
                   offset: int = Query(0, ge=0), actor: str = ADMIN) -> dict:
    async with _maker(request)() as s:
        q = select(Payment).order_by(Payment.id.desc())
        if status:
            q = q.where(Payment.status == status)
        if user_id:
            q = q.where(Payment.user_id == user_id)
        total = await s.scalar(select(func.count()).select_from(q.subquery())) or 0
        items = [_payment_row(p) for p in (await s.scalars(q.limit(limit).offset(offset))).all()]
        return _page(total, items, limit, offset)


class RefundBody(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


@router.post("/payments/{payment_id}/refund")
async def refund_payment(request: Request, payment_id: int, b: RefundBody, actor: str = ADMIN) -> dict:
    gw = getattr(request.app.state, "stars_gateway", None)
    if gw is None:
        raise HTTPException(503, "Telegram bot not configured; refunds unavailable")
    async with _maker(request)() as s:
        try:
            p = await pay.refund(s, gw, payment_id, actor)
        except pay.PaymentError as e:
            raise HTTPException(409, str(e)) from e
        await audit(s, actor, "payment.refund_reason", f"payment:{p.id}", reason=b.reason)
        await s.commit()
        return _payment_row(p)


# ------------------------------------------------------------------- system

@router.get("/system")
async def system(request: Request, actor: str = SUPPORT) -> dict:
    settings = _settings(request)
    async with _maker(request)() as s:
        outbox = dict((await s.execute(select(OutboundMessage.status, func.count(OutboundMessage.id))
                                       .group_by(OutboundMessage.status))).all())
        dead = (await s.scalars(select(OutboundMessage).where(OutboundMessage.status == "dead")
                                .order_by(OutboundMessage.id.desc()).limit(50))).all()
        pending = await s.scalar(select(func.count(Signal.id)).where(
            Signal.status == SignalStatus.VALIDATED)) or 0
        return {
            "env": settings.env.value, "kill_switch": bool(await get_flag(s, KILL_SWITCH, False)),
            "pending_review": pending,
            "publish_mode": (await effective_publish_mode(s, settings)).value,
            "publish_mode_default": settings.publish_mode.value,
            "strategies": [{"name": n, "disabled": n in (await get_flag(s, DISABLED_STRATEGIES, []) or [])}
                           for n in sorted(REGISTRY)],
            "market_data_provider": settings.market_data_provider,
            "max_quote_age_seconds": settings.max_quote_age_seconds,
            "private_channel_configured": settings.private_channel_id is not None,
            "bot_configured": getattr(request.app.state, "bot", None) is not None,
            "ai_configured": settings.anthropic_api_key is not None,
            "safety_problems": settings.require_production_safety(),
            "outbox": outbox,
            "dead_letters": [{"id": m.id, "dedup_key": m.dedup_key, "chat_id": m.chat_id,
                              "attempts": m.attempts, "last_error": m.last_error,
                              "created_at": m.created_at} for m in dead],
        }


class KillSwitch(BaseModel):
    on: bool


@router.post("/kill-switch")
async def kill_switch(request: Request, k: KillSwitch, actor: str = ADMIN) -> dict:
    async with _maker(request)() as s:
        await set_flag(s, KILL_SWITCH, k.on, actor)
    return {"kill_switch": k.on}


class PublishModeBody(BaseModel):
    mode: PublishMode


@router.post("/system/publish-mode")
async def set_publish_mode(request: Request, b: PublishModeBody, actor: str = ADMIN) -> dict:
    async with _maker(request)() as s:
        await set_flag(s, PUBLISH_MODE, b.mode.value, actor)
    return {"publish_mode": b.mode.value}


class StrategyToggle(BaseModel):
    name: str
    disabled: bool


@router.post("/system/strategies")
async def toggle_strategy(request: Request, b: StrategyToggle, actor: str = ADMIN) -> dict:
    if b.name not in REGISTRY:
        raise HTTPException(404, "unknown strategy")
    async with _maker(request)() as s:
        current = set(await get_flag(s, DISABLED_STRATEGIES, []) or [])
        (current.add if b.disabled else current.discard)(b.name)
        await set_flag(s, DISABLED_STRATEGIES, sorted(current), actor)
    return {"disabled": sorted(current)}


@router.post("/outbox/{message_id}/retry")
async def retry_dead_letter(request: Request, message_id: int, actor: str = ADMIN) -> dict:
    async with _maker(request)() as s:
        m = await s.get(OutboundMessage, message_id)
        if m is None or m.status != "dead":
            raise HTTPException(409, "only dead letters can be retried")
        m.status, m.attempts = "pending", 0
        await audit(s, actor, "outbox.retry", m.dedup_key)
        await s.commit()
        return {"id": m.id, "status": m.status}


# -------------------------------------------------------------------- audit

@router.get("/audit")
async def audit_log(request: Request, action: str | None = None, actor_q: str | None = None,
                    limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0),
                    actor: str = ADMIN) -> dict:
    async with _maker(request)() as s:
        q = select(AuditLog).order_by(AuditLog.id.desc())
        if action:
            q = q.where(AuditLog.action.like(f"{action}%"))
        if actor_q:
            q = q.where(AuditLog.actor.like(f"%{actor_q}%"))
        total = await s.scalar(select(func.count()).select_from(q.subquery())) or 0
        items = [{"id": a.id, "actor": a.actor, "action": a.action, "target": a.target,
                  "data": a.data, "at": a.created_at}
                 for a in (await s.scalars(q.limit(limit).offset(offset))).all()]
        return _page(total, items, limit, offset)

