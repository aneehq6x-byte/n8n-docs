"""FastAPI application: health, Telegram webhook, admin API."""

from __future__ import annotations

import hmac
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from umip.api.admin import router as admin_router
from umip.config import Settings, get_settings
from umip.db import create_all, make_engine, make_sessionmaker
from umip.flags import KILL_SWITCH, get_flag


def create_app(settings: Settings | None = None, maker: async_sessionmaker | None = None,
               dispatcher=None, bot=None, stars_gateway=None) -> FastAPI:
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
                  docs_url=None if settings.env == "prod" else "/docs",
                  openapi_url=None if settings.env == "prod" else "/openapi.json")
    app.state.settings = settings
    if maker is not None:
        app.state.maker = maker
    app.state.dispatcher = dispatcher
    app.state.bot = bot
    if stars_gateway is None and bot is not None:
        from umip.bot.gateways import AiogramStarsGateway
        stars_gateway = AiogramStarsGateway(bot)
    app.state.stars_gateway = stars_gateway

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

    app.include_router(admin_router)
    return app
