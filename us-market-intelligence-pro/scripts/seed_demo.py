"""Seed a LOCAL database with demo data for the admin dashboard.

All data goes through the real services (invoices, payment processing, signal
lifecycle), so the dashboard shows exactly what production code would produce.
Signals are flagged as mock data / paper where appropriate. Refuses to run in prod.

    UMIP_DATABASE_URL=... python -m scripts.seed_demo
"""

from __future__ import annotations

import asyncio
import random
from datetime import timedelta

from sqlalchemy import select

from umip.config import Environment, PublishMode, get_settings
from umip.db import create_all, make_engine, make_sessionmaker
from umip.models import Coupon, OutboundMessage, ResultKind, SignalStatus as S, User
from umip.payments import service as pay
from umip.quant.strategies import Candidate
from umip.risk.engine import RiskDecision
from umip.signals import service as sig
from umip.subscriptions.service import get_plan, grant_period, seed_default_plans
from umip.timeutil import utcnow

CHANNEL = -1000000000001
KEY = "demo-signing-key"
NAMES = ["sara", "khalid", "noura", "faisal", "reem", "omar", "lama", "turki", "hind", "majed",
         "dana", "yousef", "abeer", "saud", "maha", "nasser", "ghada", "fahad", "jawaher", "bader",
         "amal", "rakan", "shahad", "ziyad", "wejdan", "hamad", "lulwa", "mishal", "areej", "sultan"]


async def main() -> None:
    settings = get_settings()
    if settings.env == Environment.PROD:
        raise SystemExit("refusing to seed demo data in prod")
    rng = random.Random(42)
    engine = make_engine(settings.database_url)
    await create_all(engine)
    maker = make_sessionmaker(engine)
    now = utcnow()
    async with maker() as s:
        if await s.scalar(select(User.id).limit(1)):
            raise SystemExit("database is not empty; seed into a fresh database")
        await seed_default_plans(s)
        s.add_all([Coupon(code="LAUNCH25", percent_off=25, max_redemptions=200),
                   Coupon(code="RAMADAN15", percent_off=15, active=False)])
        await s.commit()

        plans = ["monthly", "monthly", "quarterly", "quarterly", "semiannual", "annual"]
        for i, name in enumerate(NAMES):
            joined = now - timedelta(days=rng.randint(1, 85), hours=rng.randint(0, 23))
            u = User(telegram_id=700000000 + i * 7919, username=name, language="ar" if i % 5 else "en",
                     accepted_terms_at=joined, created_at=joined,
                     last_seen_at=now - timedelta(hours=rng.randint(1, 200)))
            s.add(u)
            await s.commit()
            if i % 4 == 3:
                continue  # registered, never paid
            plan = await get_plan(s, plans[i % len(plans)])
            coupon = "LAUNCH25" if i % 7 == 0 else None
            paid_at = min(joined + timedelta(hours=rng.randint(1, 48)), now - timedelta(minutes=5))
            inv = await pay.create_invoice(s, KEY, u, plan, coupon)
            await pay.process_successful_payment(
                s, KEY, u.telegram_id, inv.payload, "XTR", inv.amount, f"demo_{i:04d}",
                is_recurring=plan.recurring, is_first_recurring=plan.recurring, now=paid_at)
            if i % 9 == 0:
                inv2 = await pay.create_invoice(s, KEY, u, await get_plan(s, "monthly"))
                await pay.process_successful_payment(
                    s, KEY, u.telegram_id, inv2.payload, "XTR", inv2.amount, f"demo_{i:04d}_r",
                    now=paid_at + timedelta(days=2))
        # one lapsed subscriber (churn) and one complimentary grant
        lapsed = User(telegram_id=799999001, username="lapsed_user", accepted_terms_at=now - timedelta(days=80),
                      created_at=now - timedelta(days=80))
        s.add(lapsed)
        await s.commit()
        await grant_period(s, lapsed, await get_plan(s, "monthly"), None, "seed", now=now - timedelta(days=45))
        await s.commit()

        # signals: a published history with recorded outcomes, a paper set, and a review queue
        outcomes = [1.42, -1.05, 2.1, -0.98, 0.35, 1.8, -1.02, 2.55, -1.1, 1.25, None, 0.9]
        symbols = ["SPY", "QQQ", "SPX", "IWM", "QQQ", "SPY"]
        for j, r in enumerate(outcomes):
            at = now - timedelta(days=len(outcomes) - j, hours=rng.randint(0, 5))
            px = {"SPY": 600, "QQQ": 510, "SPX": 6000, "IWM": 228}[symbols[j % len(symbols)]]
            long = j % 3 != 2
            k = 1 if long else -1
            c = Candidate("orb" if j % 2 else "vwap_trend", symbols[j % len(symbols)], "long" if long else "short",
                          at, px, px - 0.1 * k, px + 0.1 * k, px - 2 * k, px + 3 * k, px + 6 * k,
                          "5m close back inside range", "Opening range break with RVOL 1.8 above VWAP",
                          timedelta(minutes=20), 60, 60 + rng.randint(0, 30))
            if not long:
                c = Candidate(**{**c.__dict__, "entry_low": px - 0.1, "entry_high": px + 0.1})
            x = await sig.create_candidate(s, c, "MOCK", at, True, kind=ResultKind.PAPER)
            await sig.validate(s, x, RiskDecision(True, []), at)
            await sig.approve(s, x, "admin:analyst:demo", PublishMode.HUMAN_APPROVAL)
            await sig.publish_paper(s, x, "admin:analyst:demo", now=at)
            if r is None:
                await sig._transition(s, x, S.EXPIRED, "system", "not entered in time")
            else:
                await sig._transition(s, x, S.ACTIVE, "tracker")
                await sig._transition(s, x, S.STOPPED if r < 0 else S.TARGET2_HIT, "tracker", None, {"r_net": r})
                x.closed_at = at + timedelta(hours=1)
            await s.commit()

        for j, (sym, px) in enumerate([("SPY", 601.2), ("QQQ", 512.4), ("NVDA", 131.7)]):
            at = now - timedelta(minutes=3 + j)
            c = Candidate("orb" if j != 1 else "vwap_trend", sym, "long", at, px, px - 0.15, px + 0.15,
                          round(px * 0.996, 2), round(px * 1.006, 2), round(px * 1.012, 2),
                          f"5m close below {px - 0.6:.2f}",
                          "Break of 15-minute opening range with relative volume 2.1 and price above session VWAP",
                          timedelta(hours=6), 60, 72 + j * 4)
            x = await sig.create_candidate(s, c, "MOCK", at, True, kind=ResultKind.PAPER)
            await sig.validate(s, x, RiskDecision(True, []), at)
        rej = await sig.create_candidate(s, Candidate("orb", "IWM", "short", now - timedelta(minutes=30), 228, 227.9,
                                                      228.1, 229, 226.5, 225, "x", "Breakdown below ORB low",
                                                      timedelta(minutes=20), 60, 48), "MOCK", now, True)
        await sig.validate(s, rej, RiskDecision(False, ["score 48 < 60", "mock data cannot produce real signals"]), now)

        s.add(OutboundMessage(dedup_key="signal:UM-DEMO:published", chat_id=CHANNEL, status="dead", attempts=5,
                              payload={"text": "demo"}, last_error="TelegramForbiddenError: bot was kicked from the channel"))
        await s.commit()
    await engine.dispose()
    print("demo data seeded")


if __name__ == "__main__":
    asyncio.run(main())
