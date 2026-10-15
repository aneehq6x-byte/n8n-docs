"""FastAPI application: health, Telegram webhook, admin API."""

from __future__ import annotations

import hmac
from contextlib import asynccontextmanager
from datetime import timedelta

from fastapi import FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from umip.config import Settings, get_settings
from umip.db import create_all, make_engine, make_sessionmaker
from umip.flags import KILL_SWITCH, get_flag, set_flag
from umip.models import (
    AuditLog, Payment, Plan, ResultKind, Signal, SignalStatus, Subscription, SubscriptionStatus,
    User,
)
from umip.api.security import require_role
from umip.performance.metrics import business_metrics, signal_performance
from umip.signals import service as sigsvc
from umip.signals.formatting import render_signal
from umip.timeutil import utcnow


class Decision(BaseModel):
    approve: bool
    reason: str = Field(default="", max_length=500)
    publish: bool = True

class KillSwitch(BaseModel):
    on: bool

class PlanUpdate(BaseModel):
    price_stars: int | None = Field(default=None, ge=1, le=100000)
    active: bool | None = None


def create_app(settings: Settings | None = None, maker: async_sessionmaker | None = None,
               dispatcher=None, bot=None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if maker is None:
            engine = make_engine(settings.database_url)
            if settings.database_url.startswith("sqlite"):
                await create_all(engine)
            app.state.maker = make_sessionmaker(engine)
        yield

    app = FastAPI(title="US Market Intelligence Pro", lifespan=lifespan,
                  docs_url=None if settings.env == "prod" else "/docs")
    app.state.settings = settings
    if maker is not None:
        app.state.maker = maker
    app.state.dispatcher = dispatcher
    app.state.bot = bot

    @app.get("/health")
    async def health() -> dict:
        async with app.state.maker() as s:
            await s.execute(select(1))
            ks = await get_flag(s, KILL_SWITCH, False)
        return {"status": "ok", "kill_switch": ks, "env": settings.env,
                "safety_problems": settings.require_production_safety()}

    @app.post("/telegram/webhook")
    async def telegram_webhook(request: Request,
                               x_telegram_bot_api_secret_token: str = Header(default="")) -> dict:
        secret = settings.telegram_webhook_secret
        if secret is None or not hmac.compare_digest(
                x_telegram_bot_api_secret_token.encode(), secret.get_secret_value().encode()):
            raise HTTPException(403, "bad secret token")
        if app.state.dispatcher is None:
            raise HTTPException(503, "bot not configured")
        from aiogram.types import Update
        update = Update.model_validate(await request.json(), context={"bot": app.state.bot})
        await app.state.dispatcher.feed_update(app.state.bot, update)
        return {"ok": True}

    # ------------------------------------------------------------ admin

    @app.get("/admin/stats")
    async def stats(actor: str = require_role("support")) -> dict:
        now = utcnow()
        async with app.state.maker() as s:
            users = await s.scalar(select(func.count(User.id)))
            active = await s.scalar(select(func.count(func.distinct(Subscription.user_id))).where(
                Subscription.status.in_((SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED)),
                Subscription.starts_at <= now, Subscription.ends_at > now))
            new_30 = await s.scalar(select(func.count(Subscription.id)).where(
                Subscription.created_at >= now - timedelta(days=30)))
            biz = await business_metrics(s, now)
        return {"users": users, "active_subscribers": active, "new_subscriptions_30d": new_30,
                **biz}

    @app.get("/admin/signals")
    async def list_signals(status: SignalStatus | None = None,
                           actor: str = require_role("analyst")) -> list[dict]:
        async with app.state.maker() as s:
            q = select(Signal).order_by(Signal.id.desc()).limit(100)
            if status:
                q = q.where(Signal.status == status)
            return [{"ref": x.ref, "status": x.status, "symbol": x.symbol, "strategy": x.strategy,
                     "direction": x.direction, "score": x.score, "kind": x.kind,
                     "is_mock": x.is_mock_data, "valid_until": x.valid_until,
                     "original": x.original} for x in (await s.scalars(q)).all()]

    @app.get("/admin/signals/{ref}/history")
    async def signal_history(ref: str, actor: str = require_role("analyst")) -> list[dict]:
        async with app.state.maker() as s:
            sig = await s.scalar(select(Signal).where(Signal.ref == ref))
            if sig is None:
                raise HTTPException(404)
            return [{"from": e.from_status, "to": e.to_status, "actor": e.actor, "note": e.note,
                     "at": e.created_at} for e in await sigsvc.history(s, sig)]

    @app.post("/admin/signals/{ref}/decision")
    async def decide(ref: str, d: Decision, actor: str = require_role("analyst")) -> dict:
        async with app.state.maker() as s:
            sig = await s.scalar(select(Signal).where(Signal.ref == ref))
            if sig is None:
                raise HTTPException(404)
            try:
                if not d.approve:
                    await sigsvc.reject(s, sig, actor, d.reason or "rejected by reviewer")
                    return {"status": sig.status}
                await sigsvc.approve(s, sig, actor, settings.publish_mode)
                if d.publish:
                    if not settings.private_channel_id:
                        raise HTTPException(409, "private channel not configured")
                    await sigsvc.publish(s, sig, settings.private_channel_id, render_signal, actor)
            except sigsvc.TransitionError as e:
                raise HTTPException(409, str(e)) from e
            except PermissionError as e:
                raise HTTPException(409, str(e)) from e
            return {"status": sig.status}

    @app.post("/admin/kill-switch")
    async def kill_switch(k: KillSwitch, actor: str = require_role("admin")) -> dict:
        async with app.state.maker() as s:
            await set_flag(s, KILL_SWITCH, k.on, actor)
        return {"kill_switch": k.on}

    @app.get("/admin/performance")
    async def performance(kind: ResultKind = ResultKind.PUBLISHED,
                          actor: str = require_role("analyst")) -> dict:
        async with app.state.maker() as s:
            return await signal_performance(s, kind)

    @app.get("/admin/plans")
    async def plans(actor: str = require_role("admin")) -> list[dict]:
        async with app.state.maker() as s:
            return [{"code": p.code, "days": p.duration_days, "stars": p.price_stars,
                     "recurring": p.recurring, "active": p.active}
                    for p in (await s.scalars(select(Plan))).all()]

    @app.patch("/admin/plans/{code}")
    async def update_plan(code: str, u: PlanUpdate, actor: str = require_role("admin")) -> dict:
        from umip.audit import audit
        async with app.state.maker() as s:
            p = await s.scalar(select(Plan).where(Plan.code == code))
            if p is None:
                raise HTTPException(404)
            if u.price_stars is not None:
                p.price_stars = u.price_stars
            if u.active is not None:
                p.active = u.active
            await audit(s, actor, "plan.updated", code, **u.model_dump(exclude_none=True))
            await s.commit()
            return {"code": p.code, "stars": p.price_stars, "active": p.active}

    @app.get("/admin/payments")
    async def payments(actor: str = require_role("admin")) -> list[dict]:
        async with app.state.maker() as s:
            q = select(Payment).order_by(Payment.id.desc()).limit(100)
            return [{"id": p.id, "user_id": p.user_id, "amount": p.amount_minor,
                     "currency": p.currency, "status": p.status, "paid_at": p.paid_at,
                     "charge_id": p.provider_charge_id} for p in (await s.scalars(q)).all()]

    @app.get("/admin/audit")
    async def audit_log(actor: str = require_role("admin")) -> list[dict]:
        async with app.state.maker() as s:
            q = select(AuditLog).order_by(AuditLog.id.desc()).limit(200)
            return [{"actor": a.actor, "action": a.action, "target": a.target, "data": a.data,
                     "at": a.created_at} for a in (await s.scalars(q)).all()]

    return app
