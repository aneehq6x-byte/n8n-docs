"""End-to-end through aiogram's Dispatcher with a recording fake Bot API session:
/start → accept terms → choose plan → pre_checkout → successful_payment → join request.
No network; the Telegram Bot API is simulated."""

from __future__ import annotations

import itertools
from datetime import datetime, timezone

import pytest
from aiogram import Bot, Dispatcher
from aiogram.client.session.base import BaseSession
from aiogram.methods import (
    AnswerCallbackQuery, AnswerPreCheckoutQuery, ApproveChatJoinRequest, CreateChatInviteLink,
    DeclineChatJoinRequest, RevokeChatInviteLink, SendInvoice, SendMessage,
)
from aiogram.types import ChatInviteLink, Message, Update
from pydantic import SecretStr
from sqlalchemy import select

from umip.bot.handlers import build_router
from umip.config import Settings
from umip.models import Payment, PaymentStatus, User
from umip.subscriptions.service import is_entitled

CHANNEL = -1001234
USER = {"id": 555, "is_bot": False, "first_name": "Sara", "language_code": "ar"}
CHAT = {"id": 555, "type": "private"}
NOW = int(datetime.now(timezone.utc).timestamp())


class RecordingSession(BaseSession):
    def __init__(self):
        super().__init__()
        self.requests = []
        self._ids = itertools.count(1000)

    async def make_request(self, bot, method, timeout=None):
        self.requests.append(method)
        if isinstance(method, (SendMessage, SendInvoice)):
            return Message.model_validate({"message_id": next(self._ids), "date": NOW, "chat": CHAT,
                                           "text": getattr(method, "text", "")})
        if isinstance(method, CreateChatInviteLink):
            return ChatInviteLink(invite_link=f"https://t.me/+e2e{next(self._ids)}",
                                  creator={"id": 1, "is_bot": True, "first_name": "b"},
                                  creates_join_request=True, is_primary=False, is_revoked=False)
        return True

    async def close(self):
        pass

    async def stream_content(self, *a, **kw):  # pragma: no cover
        raise NotImplementedError

    def of(self, kind):
        return [r for r in self.requests if isinstance(r, kind)]


@pytest.fixture
def env(maker):
    sess = RecordingSession()
    bot = Bot("42:TEST", session=sess)
    dp = Dispatcher()
    dp.include_router(build_router())
    settings = Settings(env="test", payload_signing_key=SecretStr("k"), private_channel_id=CHANNEL)
    return bot, dp, sess, settings, maker


_uid = itertools.count(1)


async def feed(env, payload):
    bot, dp, _, settings, maker = env
    upd = Update.model_validate({"update_id": next(_uid), **payload}, context={"bot": bot})
    await dp.feed_update(bot, upd, maker=maker, settings=settings)


def msg(text=None, **extra):
    return {"message": {"message_id": next(_uid), "date": NOW, "chat": CHAT, "from": USER,
                        **({"text": text} if text else {}), **extra}}


def cb(data):
    return {"callback_query": {"id": str(next(_uid)), "from": USER, "chat_instance": "ci",
                               "data": data,
                               "message": {"message_id": 1, "date": NOW, "chat": CHAT, "text": "m"}}}


async def test_subscribe_pay_and_join_flow(env):
    bot, dp, sess, settings, maker = env
    await feed(env, msg("/start"))
    assert "إفصاح المخاطر" in sess.of(SendMessage)[-1].text  # terms first, Arabic default

    await feed(env, cb("m:spx"))  # blocked before accepting terms
    assert sess.of(AnswerCallbackQuery)[-1].show_alert

    await feed(env, cb("terms:accept"))
    await feed(env, cb("m:spx"))  # premium section, not subscribed
    assert "للمشتركين فقط" in sess.of(SendMessage)[-1].text

    await feed(env, cb("m:subscribe"))
    plans_kb = sess.of(SendMessage)[-1].reply_markup.inline_keyboard
    assert any(b.callback_data == "buy:quarterly" for row in plans_kb for b in row)

    await feed(env, cb("buy:quarterly"))
    inv = sess.of(SendInvoice)[-1]
    assert inv.currency == "XTR" and inv.provider_token == "" and len(inv.prices) == 1

    # Tampered amount is rejected at pre-checkout
    await feed(env, {"pre_checkout_query": {"id": "pc0", "from": USER, "currency": "XTR",
                                            "total_amount": inv.prices[0].amount - 1,
                                            "invoice_payload": inv.payload}})
    assert sess.of(AnswerPreCheckoutQuery)[-1].ok is False

    await feed(env, {"pre_checkout_query": {"id": "pc1", "from": USER, "currency": "XTR",
                                            "total_amount": inv.prices[0].amount,
                                            "invoice_payload": inv.payload}})
    assert sess.of(AnswerPreCheckoutQuery)[-1].ok is True

    paid = {"currency": "XTR", "total_amount": inv.prices[0].amount,
            "invoice_payload": inv.payload, "telegram_payment_charge_id": "tg_ch_1",
            "provider_payment_charge_id": ""}
    await feed(env, msg(successful_payment=paid))
    await feed(env, msg(successful_payment=paid))  # redelivery: no second grant / message
    confirmations = [m for m in sess.of(SendMessage) if "تم تأكيد الدفع" in m.text]
    assert len(confirmations) == 1
    join_url = confirmations[0].reply_markup.inline_keyboard[0][0].url
    assert join_url.startswith("https://t.me/+e2e")

    async with maker() as s:
        u = await s.scalar(select(User).where(User.telegram_id == 555))
        assert await is_entitled(s, u.id)
        p = await s.scalar(select(Payment))
        assert p.status == PaymentStatus.PAID and p.provider_charge_id == "tg_ch_1"

    join = {"chat_join_request": {"chat": {"id": CHANNEL, "type": "channel", "title": "VIP"},
                                  "from": USER, "user_chat_id": 555, "date": NOW,
                                  "invite_link": {"invite_link": join_url,
                                                  "creator": {"id": 1, "is_bot": True,
                                                              "first_name": "b"},
                                                  "creates_join_request": True,
                                                  "is_primary": False, "is_revoked": False}}}
    await feed(env, join)
    assert sess.of(ApproveChatJoinRequest)[-1].user_id == 555
    assert sess.of(RevokeChatInviteLink)[-1].invite_link == join_url

    intruder = dict(join["chat_join_request"], **{"from": {**USER, "id": 777}, "user_chat_id": 777})
    await feed(env, {"chat_join_request": intruder})
    assert sess.of(DeclineChatJoinRequest)[-1].user_id == 777


async def test_language_toggle_and_no_opportunities_message(env):
    bot, dp, sess, settings, maker = env
    await feed(env, msg("/start"))
    await feed(env, cb("terms:accept"))
    await feed(env, cb("trial"))
    assert "فعّال" in sess.of(SendMessage)[-1].text
    await feed(env, cb("trial"))
    assert sess.of(AnswerCallbackQuery)[-1].show_alert  # trial only once
    await feed(env, cb("m:opportunities"))
    assert "لا توجد فرصة تستوفي معايير التداول حاليًا" in sess.of(SendMessage)[-1].text


async def test_paysupport_command(env):
    bot, dp, sess, settings, maker = env
    await feed(env, msg("/paysupport"))
    assert "دعم المدفوعات" in sess.of(SendMessage)[-1].text
