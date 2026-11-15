"""Entrypoints.

    python -m umip.main api       # FastAPI (webhook + admin) via uvicorn
    python -m umip.main polling   # local dev: bot long-polling + jobs
    python -m umip.main seed      # create tables (sqlite dev) and default plans
"""

from __future__ import annotations

import asyncio
import logging
import sys
from datetime import timedelta

from umip.config import get_settings
from umip.db import create_all, make_engine, make_sessionmaker

log = logging.getLogger("umip")


def build_bot(settings):
    from aiogram import Bot, Dispatcher
    from aiogram.client.default import DefaultBotProperties
    from aiogram.client.session.aiohttp import AiohttpSession
    from aiogram.client.telegram import TEST

    from umip.bot.handlers import build_router

    if settings.telegram_bot_token is None:
        raise SystemExit("UMIP_TELEGRAM_BOT_TOKEN is not set")
    session = AiohttpSession(api=TEST) if settings.telegram_use_test_env else None
    bot = Bot(settings.telegram_bot_token.get_secret_value(), session=session,
              default=DefaultBotProperties(parse_mode=None))
    dp = Dispatcher()
    dp.include_router(build_router())
    return bot, dp


async def jobs_loop(maker, bot, settings, every_seconds: int = 60) -> None:
    from umip.bot.gateways import AiogramChatGateway, AiogramSender
    from umip.jobs import signal_maintenance, subscription_maintenance
    from umip.notifications import dispatch

    from umip.market_data.factory import build_provider
    from umip.market_data.health import FeedHealth
    from umip.signals.tracker import track_open_signals

    gw, sender = AiogramChatGateway(bot), AiogramSender(bot)
    provider, health = build_provider(settings), FeedHealth()
    while True:
        try:
            async with maker() as s:
                await subscription_maintenance(s, gw, settings.private_channel_id,
                                               settings.renewal_reminder_days,
                                               timedelta(hours=settings.expiry_grace_hours))
                await signal_maintenance(s)
                await track_open_signals(s, provider, health, settings.private_channel_id)
                stats = await dispatch(s, sender)
                if stats["dead"]:
                    log.error("outbox dead letters: %s", stats)
        except Exception:  # keep the loop alive; errors are logged and alerted
            log.exception("jobs loop iteration failed")
        await asyncio.sleep(every_seconds)


async def _seed(settings) -> None:
    from umip.subscriptions.service import seed_default_plans

    engine = make_engine(settings.database_url)
    await create_all(engine)
    async with make_sessionmaker(engine)() as s:
        await seed_default_plans(s)
    print("seeded")


async def _polling(settings) -> None:
    engine = make_engine(settings.database_url)
    await create_all(engine)
    maker = make_sessionmaker(engine)
    bot, dp = build_bot(settings)
    asyncio.create_task(jobs_loop(maker, bot, settings))
    await dp.start_polling(bot, maker=maker, settings=settings,
                           allowed_updates=["message", "callback_query", "pre_checkout_query",
                                            "chat_join_request", "chat_member"])


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = get_settings()
    cmd = sys.argv[1] if len(sys.argv) > 1 else "api"
    problems = settings.require_production_safety()
    if problems and cmd != "new-admin-key":
        raise SystemExit("refusing to start: " + "; ".join(problems))
    if cmd == "new-admin-key":
        from umip.api.security import new_key
        key, digest = new_key()
        print(f"key (give to the admin once, never store):\n  {key}\n"
              f"config entry for UMIP_ADMIN_API_KEYS:\n  \"{digest}\": \"admin|analyst|support\"")
        return
    if cmd == "seed":
        asyncio.run(_seed(settings))
    elif cmd == "polling":
        asyncio.run(_polling(settings))
    elif cmd == "api":
        import uvicorn

        from umip.api.app import create_app

        bot = dp = None
        if settings.telegram_bot_token:
            bot, dp = build_bot(settings)
        app = create_app(settings, dispatcher=dp, bot=bot)
        if dp is not None:
            @app.on_event("startup")
            async def _inject() -> None:
                dp["maker"] = app.state.maker
                dp["settings"] = settings
        uvicorn.run(app, host="0.0.0.0", port=8000)
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
