"""ORM models for the modular monolith.

Conventions:
- All timestamps are timezone-aware UTC.
- Money: Telegram Stars are integers (``amount_minor``); fiat uses minor units.
- Financial and signal history is append-only (events/ledger); rows are never
  rewritten to change what was originally published.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    JSON, BigInteger, Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, Text,
    UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from umip.db import Base


def _ts(**kw) -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), **kw)


# --------------------------------------------------------------------- users


class Role(StrEnum):
    USER = "user"
    SUPPORT = "support"
    ANALYST = "analyst"
    ADMIN = "admin"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True)
    username: Mapped[str | None] = mapped_column(String(64))
    language: Mapped[str] = mapped_column(String(2), default="ar")
    timezone_pref: Mapped[str] = mapped_column(String(32), default="Asia/Riyadh")
    role: Mapped[Role] = mapped_column(Enum(Role), default=Role.USER)
    accepted_terms_at: Mapped[datetime | None] = _ts(nullable=True)
    referral_code: Mapped[str | None] = mapped_column(String(16), unique=True)
    referred_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = _ts(server_default=func.now())
    last_seen_at: Mapped[datetime | None] = _ts(nullable=True)
    is_blocked: Mapped[bool] = mapped_column(Boolean, default=False)


# ------------------------------------------------------------- subscriptions


class Plan(Base):
    __tablename__ = "plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    name_ar: Mapped[str] = mapped_column(String(64))
    name_en: Mapped[str] = mapped_column(String(64))
    duration_days: Mapped[int] = mapped_column(Integer)
    price_stars: Mapped[int] = mapped_column(Integer)
    # Telegram Stars recurring subscriptions only support a 30-day period.
    recurring: Mapped[bool] = mapped_column(Boolean, default=False)
    is_trial: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    tier: Mapped[str] = mapped_column(String(16), default="pro")
    ai_daily_quota: Mapped[int] = mapped_column(Integer, default=20)


class Coupon(Base):
    __tablename__ = "coupons"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    percent_off: Mapped[int] = mapped_column(Integer)
    max_redemptions: Mapped[int | None] = mapped_column(Integer)
    redemptions: Mapped[int] = mapped_column(Integer, default=0)
    valid_until: Mapped[datetime | None] = _ts(nullable=True)
    plan_codes: Mapped[list | None] = mapped_column(JSON)  # None = all plans
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class SubscriptionStatus(StrEnum):
    ACTIVE = "active"
    EXPIRED = "expired"
    REFUNDED = "refunded"
    CANCELLED = "cancelled"  # renewal off; access stays until ends_at


class Subscription(Base):
    """One row per paid (or trial) access period. Renewals add rows."""

    __tablename__ = "subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id"))
    payment_id: Mapped[int | None] = mapped_column(ForeignKey("payments.id"), unique=True)
    starts_at: Mapped[datetime] = _ts()
    ends_at: Mapped[datetime] = _ts(index=True)
    status: Mapped[SubscriptionStatus] = mapped_column(
        Enum(SubscriptionStatus), default=SubscriptionStatus.ACTIVE
    )
    auto_renew: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = _ts(server_default=func.now())

    plan: Mapped[Plan] = relationship(lazy="joined")


class TrialUsage(Base):
    __tablename__ = "trial_usage"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    used_at: Mapped[datetime] = _ts(server_default=func.now())


# ------------------------------------------------------------------ payments


class PaymentStatus(StrEnum):
    PENDING = "pending"  # invoice issued
    PAID = "paid"
    REFUNDED = "refunded"
    FAILED = "failed"


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (UniqueConstraint("provider", "provider_charge_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id"))
    provider: Mapped[str] = mapped_column(String(32))  # telegram_stars | sandbox | ...
    currency: Mapped[str] = mapped_column(String(8))
    amount_minor: Mapped[int] = mapped_column(Integer)
    nonce: Mapped[str] = mapped_column(String(32), unique=True)
    coupon_code: Mapped[str | None] = mapped_column(String(32))
    status: Mapped[PaymentStatus] = mapped_column(Enum(PaymentStatus), default=PaymentStatus.PENDING)
    provider_charge_id: Mapped[str | None] = mapped_column(String(128))
    is_recurring: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = _ts(server_default=func.now())
    paid_at: Mapped[datetime | None] = _ts(nullable=True)
    refunded_at: Mapped[datetime | None] = _ts(nullable=True)
    raw: Mapped[dict | None] = mapped_column(JSON)


class LedgerEntry(Base):
    """Append-only financial journal."""

    __tablename__ = "ledger"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    payment_id: Mapped[int] = mapped_column(ForeignKey("payments.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # charge | refund
    currency: Mapped[str] = mapped_column(String(8))
    amount_minor: Mapped[int] = mapped_column(Integer)  # refunds negative
    created_at: Mapped[datetime] = _ts(server_default=func.now())


# ---------------------------------------------------------------- membership


class InviteLink(Base):
    __tablename__ = "invite_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    chat_id: Mapped[int] = mapped_column(BigInteger)
    link: Mapped[str] = mapped_column(String(256), unique=True)
    expires_at: Mapped[datetime] = _ts()
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    used_at: Mapped[datetime | None] = _ts(nullable=True)
    created_at: Mapped[datetime] = _ts(server_default=func.now())


class ChannelMember(Base):
    __tablename__ = "channel_members"
    __table_args__ = (UniqueConstraint("user_id", "chat_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    chat_id: Mapped[int] = mapped_column(BigInteger)
    joined_at: Mapped[datetime | None] = _ts(nullable=True)
    removed_at: Mapped[datetime | None] = _ts(nullable=True)
    is_member: Mapped[bool] = mapped_column(Boolean, default=False)


# ------------------------------------------------------------------- signals


class SignalStatus(StrEnum):
    CANDIDATE = "candidate"
    VALIDATED = "validated"
    APPROVED = "approved"
    PUBLISHED = "published"
    ACTIVE = "active"  # entry filled
    TARGET1_HIT = "target1_hit"
    TARGET2_HIT = "target2_hit"
    STOPPED = "stopped"
    EXPIRED = "expired"  # never entered — neither win nor loss
    CANCELLED = "cancelled"
    REJECTED = "rejected"


class ResultKind(StrEnum):
    BACKTEST = "backtest"
    PAPER = "paper"
    PUBLISHED = "published"


class Signal(Base):
    __tablename__ = "signals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ref: Mapped[str] = mapped_column(String(24), unique=True, index=True)
    status: Mapped[SignalStatus] = mapped_column(Enum(SignalStatus), index=True)
    kind: Mapped[ResultKind] = mapped_column(Enum(ResultKind), default=ResultKind.PUBLISHED)
    strategy: Mapped[str] = mapped_column(String(48))
    symbol: Mapped[str] = mapped_column(String(16), index=True)
    direction: Mapped[str] = mapped_column(String(8))  # long | short
    # Immutable snapshot of the signal as first validated (prices, contract, data source...).
    original: Mapped[dict] = mapped_column(JSON)
    score: Mapped[float] = mapped_column(Float)
    detected_at: Mapped[datetime] = _ts()
    published_at: Mapped[datetime | None] = _ts(nullable=True)
    valid_until: Mapped[datetime] = _ts()
    closed_at: Mapped[datetime | None] = _ts(nullable=True)
    is_mock_data: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[str] = mapped_column(String(32), default="engine")  # engine | admin:<id>


class SignalEvent(Base):
    """Append-only history of every state change / update for a signal."""

    __tablename__ = "signal_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    signal_id: Mapped[int] = mapped_column(ForeignKey("signals.id"), index=True)
    from_status: Mapped[str | None] = mapped_column(String(16))
    to_status: Mapped[str] = mapped_column(String(16))
    actor: Mapped[str] = mapped_column(String(48))
    note: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = _ts(server_default=func.now())


class OutboundMessage(Base):
    """Dedup key for notifications so restarts never double-send."""

    __tablename__ = "outbound_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dedup_key: Mapped[str] = mapped_column(String(128), unique=True)
    chat_id: Mapped[int] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending|sent|failed|dead
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    payload: Mapped[dict] = mapped_column(JSON)
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _ts(server_default=func.now())
    sent_at: Mapped[datetime | None] = _ts(nullable=True)


# --------------------------------------------------------------- operations


class SystemFlag(Base):
    """Kill switch, circuit-breaker state and other runtime toggles."""

    __tablename__ = "system_flags"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)
    updated_at: Mapped[datetime] = _ts(server_default=func.now(), onupdate=func.now())
    updated_by: Mapped[str] = mapped_column(String(48), default="system")


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(64), index=True)
    target: Mapped[str | None] = mapped_column(String(128))
    data: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = _ts(server_default=func.now())


class AIUsage(Base):
    __tablename__ = "ai_usage"
    __table_args__ = (UniqueConstraint("user_id", "day"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    day: Mapped[str] = mapped_column(String(10))
    count: Mapped[int] = mapped_column(Integer, default=0)
