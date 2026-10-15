"""aiogram v3 handlers. Business logic lives in the services; handlers only
translate Telegram updates to service calls."""

from __future__ import annotations

from aiogram import F, Router
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    CallbackQuery, ChatJoinRequest, InlineKeyboardButton, InlineKeyboardMarkup, LabeledPrice,
    Message, PreCheckoutQuery,
)
from aiogram.utils.keyboard import InlineKeyboardBuilder
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from umip.bot.gateways import AiogramChatGateway
from umip.bot.i18n import MENU, PREMIUM_SECTIONS, t
from umip.config import Settings
from umip.membership.service import AccessDenied, handle_join_request, issue_invite
from umip.models import Signal, User
from umip.payments import service as pay
from umip.signals.service import OPEN_STATES
from umip.subscriptions.service import (
    entitlement_end, get_plan, is_entitled, list_plans, start_trial,
)
from umip.timeutil import format_dual, utcnow



def main_menu(lang: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for cb, ar, en in MENU:
        kb.button(text=ar if lang == "ar" else en, callback_data=f"m:{cb}")
    kb.button(text="English" if lang == "ar" else "العربية", callback_data="lang:toggle")
    kb.adjust(2)
    return kb.as_markup()


async def get_or_create_user(session: AsyncSession, tg_user) -> User:
    u = await session.scalar(select(User).where(User.telegram_id == tg_user.id))
    if u is None:
        lang = "en" if (tg_user.language_code or "").startswith("en") else "ar"
        u = User(telegram_id=tg_user.id, username=tg_user.username, language=lang)
        session.add(u)
    u.last_seen_at = utcnow()
    await session.commit()
    return u


async def on_start(message: Message, maker: async_sessionmaker) -> None:
    async with maker() as s:
        u = await get_or_create_user(s, message.from_user)
    if u.accepted_terms_at is None:
        kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(
            text=t("accept", u.language), callback_data="terms:accept")]])
        await message.answer(t("terms", u.language) + "\n\n" + t("terms_required", u.language),
                             reply_markup=kb)
        return
    await message.answer(t("welcome", u.language), reply_markup=main_menu(u.language))


async def on_accept(cb: CallbackQuery, maker: async_sessionmaker) -> None:
    async with maker() as s:
        u = await get_or_create_user(s, cb.from_user)
        u.accepted_terms_at = utcnow()
        await s.commit()
    await cb.message.answer(t("welcome", u.language), reply_markup=main_menu(u.language))
    await cb.answer()


async def on_lang(cb: CallbackQuery, maker: async_sessionmaker) -> None:
    async with maker() as s:
        u = await get_or_create_user(s, cb.from_user)
        u.language = "en" if u.language == "ar" else "ar"
        await s.commit()
    await cb.message.edit_reply_markup(reply_markup=main_menu(u.language))
    await cb.answer()


async def on_menu(cb: CallbackQuery, maker: async_sessionmaker, settings: Settings) -> None:
    section = cb.data[2:]
    async with maker() as s:
        u = await get_or_create_user(s, cb.from_user)
        lang = u.language
        if u.accepted_terms_at is None:
            await cb.answer(t("terms_required", lang), show_alert=True)
            return
        if section in PREMIUM_SECTIONS and not await is_entitled(s, u.id):
            await cb.message.answer(t("need_sub", lang))
            await cb.answer()
            return
        if section in ("subscribe", "renew"):
            await _show_plans(cb.message, s, lang)
        elif section == "my_sub":
            end = await entitlement_end(s, u.id)
            await cb.message.answer(t("sub_active", lang, end=format_dual(end)) if end
                                    else t("sub_none", lang))
        elif section == "terms":
            await cb.message.answer(t("terms", lang))
        elif section == "support":
            await cb.message.answer(t("support", lang))
        elif section in ("opportunities", "spx", "ndx", "stocks", "options"):
            await _show_open_signals(cb.message, s, section, lang)
        else:
            await cb.message.answer(t("coming", lang))
    await cb.answer()


SECTION_SYMBOLS = {"spx": {"SPX", "SPY", "XSP"}, "ndx": {"NDX", "QQQ"}}


async def _show_open_signals(msg: Message, s: AsyncSession, section: str, lang: str) -> None:
    q = select(Signal).where(Signal.status.in_(OPEN_STATES), Signal.valid_until > utcnow())
    sigs = list((await s.scalars(q)).all())
    if section in SECTION_SYMBOLS:
        sigs = [x for x in sigs if x.symbol in SECTION_SYMBOLS[section]]
    elif section == "options":
        sigs = [x for x in sigs if x.original.get("option")]
    elif section == "stocks":
        sigs = [x for x in sigs if x.symbol not in {"SPX", "SPY", "NDX", "QQQ", "RUT", "IWM",
                                                    "DIA", "VIX", "XSP"}]
    if not sigs:
        await msg.answer(t("no_opps", lang))
        return
    from umip.signals.formatting import render_signal
    for sig in sigs[:5]:
        p = render_signal(sig, lang)
        await msg.answer(p["text"], parse_mode="HTML")


async def _show_plans(msg: Message, s: AsyncSession, lang: str) -> None:
    kb = InlineKeyboardBuilder()
    for p in await list_plans(s):
        name = p.name_ar if lang == "ar" else p.name_en
        if p.is_trial:
            kb.button(text=t("trial_btn", lang), callback_data="trial")
        else:
            kb.button(text=f"{name} — {p.price_stars} ⭐", callback_data=f"buy:{p.code}")
    kb.adjust(1)
    await msg.answer(t("choose_plan", lang), reply_markup=kb.as_markup())


async def on_buy(cb: CallbackQuery, maker: async_sessionmaker, settings: Settings) -> None:
    async with maker() as s:
        u = await get_or_create_user(s, cb.from_user)
        plan = await get_plan(s, cb.data[4:])
        if plan is None:
            await cb.answer("plan unavailable", show_alert=True)
            return
        inv = await pay.create_invoice(s, settings.payload_signing_key.get_secret_value(),
                                       u, plan, lang=u.language)
    prices = [LabeledPrice(label=inv.title, amount=inv.amount)]
    if inv.subscription_period:
        link = await cb.bot.create_invoice_link(
            title=inv.title, description=inv.description, payload=inv.payload, currency=pay.STARS,
            prices=prices, provider_token="", subscription_period=inv.subscription_period)
        kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(
            text=f"⭐ {inv.amount}", url=link)]])
        await cb.message.answer(inv.title, reply_markup=kb)
    else:
        await cb.message.answer_invoice(title=inv.title, description=inv.description,
                                        payload=inv.payload, currency=pay.STARS, prices=prices,
                                        provider_token="")
    await cb.answer()


async def on_trial(cb: CallbackQuery, maker: async_sessionmaker, settings: Settings) -> None:
    async with maker() as s:
        u = await get_or_create_user(s, cb.from_user)
        try:
            g = await start_trial(s, u)
        except ValueError:
            await cb.answer(t("trial_used", u.language), show_alert=True)
            return
        await cb.message.answer(t("sub_active", u.language, end=format_dual(g.ends_at)))
    await cb.answer()


async def on_pre_checkout(q: PreCheckoutQuery, maker: async_sessionmaker, settings: Settings) -> None:
    # Must answer within 10 seconds.
    try:
        async with maker() as s:
            await pay.validate_pre_checkout(s, settings.payload_signing_key.get_secret_value(),
                                            q.from_user.id, q.invoice_payload, q.currency,
                                            q.total_amount)
    except pay.PaymentError as e:
        await q.answer(ok=False, error_message=f"Payment rejected: {e}")
        return
    await q.answer(ok=True)


async def on_paid(message: Message, maker: async_sessionmaker, settings: Settings) -> None:
    sp = message.successful_payment
    async with maker() as s:
        u = await get_or_create_user(s, message.from_user)
        res = await pay.process_successful_payment(
            s, settings.payload_signing_key.get_secret_value(), message.from_user.id,
            sp.invoice_payload, sp.currency, sp.total_amount, sp.telegram_payment_charge_id,
            bool(sp.is_recurring), bool(sp.is_first_recurring),
            raw=sp.model_dump(mode="json"))
        if not res.newly_processed:
            return
        kb = None
        if settings.private_channel_id:
            try:
                link = await issue_invite(s, AiogramChatGateway(message.bot), u,
                                          settings.private_channel_id,
                                          settings.invite_link_ttl_seconds)
                kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(
                    text=t("join_btn", u.language), url=link)]])
            except AccessDenied:
                pass
        await message.answer(t("paid_ok", u.language, end=format_dual(res.ends_at)),
                             reply_markup=kb)


async def on_join_request(req: ChatJoinRequest, maker: async_sessionmaker,
                          settings: Settings) -> None:
    if req.chat.id != settings.private_channel_id:
        return
    async with maker() as s:
        await handle_join_request(s, AiogramChatGateway(req.bot), req.chat.id, req.from_user.id,
                                  req.invite_link.invite_link if req.invite_link else None)


async def on_paysupport(message: Message, maker: async_sessionmaker) -> None:
    async with maker() as s:
        u = await get_or_create_user(s, message.from_user)
    await message.answer(t("paysupport", u.language))


def build_router() -> Router:
    r = Router(name="main")
    r.message.register(on_start, CommandStart())
    r.message.register(on_paysupport, Command("paysupport"))
    r.callback_query.register(on_accept, F.data == "terms:accept")
    r.callback_query.register(on_lang, F.data == "lang:toggle")
    r.callback_query.register(on_menu, F.data.startswith("m:"))
    r.callback_query.register(on_buy, F.data.startswith("buy:"))
    r.callback_query.register(on_trial, F.data == "trial")
    r.pre_checkout_query.register(on_pre_checkout)
    r.message.register(on_paid, F.successful_payment)
    r.chat_join_request.register(on_join_request)
    return r
