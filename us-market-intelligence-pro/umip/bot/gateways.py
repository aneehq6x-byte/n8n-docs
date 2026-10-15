"""Thin adapters from our service Protocols to aiogram's Bot."""

from __future__ import annotations

from datetime import datetime

from aiogram import Bot
from aiogram.types import InlineKeyboardMarkup


class AiogramChatGateway:
    def __init__(self, bot: Bot):
        self.bot = bot

    async def create_invite_link(self, chat_id: int, name: str, expire_date: datetime,
                                 member_limit: int | None, creates_join_request: bool) -> str:
        link = await self.bot.create_chat_invite_link(
            chat_id=chat_id, name=name, expire_date=expire_date,
            member_limit=None if creates_join_request else member_limit,
            creates_join_request=creates_join_request)
        return link.invite_link

    async def revoke_invite_link(self, chat_id: int, link: str) -> None:
        await self.bot.revoke_chat_invite_link(chat_id=chat_id, invite_link=link)

    async def approve_join_request(self, chat_id: int, user_id: int) -> None:
        await self.bot.approve_chat_join_request(chat_id=chat_id, user_id=user_id)

    async def decline_join_request(self, chat_id: int, user_id: int) -> None:
        await self.bot.decline_chat_join_request(chat_id=chat_id, user_id=user_id)

    async def remove_member(self, chat_id: int, user_id: int) -> None:
        # ban + unban = remove without a permanent ban; rejoin needs a fresh approved link.
        await self.bot.ban_chat_member(chat_id=chat_id, user_id=user_id)
        await self.bot.unban_chat_member(chat_id=chat_id, user_id=user_id, only_if_banned=True)


class AiogramStarsGateway:
    def __init__(self, bot: Bot):
        self.bot = bot

    async def refund_star_payment(self, user_id: int, telegram_payment_charge_id: str) -> bool:
        return await self.bot.refund_star_payment(
            user_id=user_id, telegram_payment_charge_id=telegram_payment_charge_id)

    async def edit_user_star_subscription(self, user_id: int, telegram_payment_charge_id: str,
                                          is_canceled: bool) -> bool:
        return await self.bot.edit_user_star_subscription(
            user_id=user_id, telegram_payment_charge_id=telegram_payment_charge_id,
            is_canceled=is_canceled)


class AiogramSender:
    def __init__(self, bot: Bot):
        self.bot = bot

    async def send(self, chat_id: int, payload: dict) -> None:
        markup = payload.get("reply_markup")
        await self.bot.send_message(
            chat_id=chat_id, text=payload["text"], parse_mode=payload.get("parse_mode"),
            reply_markup=InlineKeyboardMarkup.model_validate(markup) if markup else None,
            disable_web_page_preview=True)
