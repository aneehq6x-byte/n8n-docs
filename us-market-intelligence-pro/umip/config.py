"""Application settings.

All secrets come from the environment (or a local, git-ignored ``.env``).
Every risk-related default is deliberately conservative.
"""

from __future__ import annotations

from enum import StrEnum
from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Environment(StrEnum):
    TEST = "test"
    DEV = "dev"
    STAGING = "staging"
    PROD = "prod"


class PublishMode(StrEnum):
    HUMAN_APPROVAL = "human_approval"
    AUTOMATIC = "automatic"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="UMIP_", env_file=".env", extra="ignore")

    env: Environment = Environment.DEV
    database_url: str = "sqlite+aiosqlite:///./umip.db"
    redis_url: str | None = None

    # Telegram
    telegram_bot_token: SecretStr | None = None
    telegram_webhook_secret: SecretStr | None = None
    telegram_webhook_url: str | None = None
    telegram_use_test_env: bool = True
    private_channel_id: int | None = None
    public_channel_id: int | None = None
    admin_telegram_ids: list[int] = Field(default_factory=list)

    # Signs invoice payloads so a forged/edited payload is rejected at pre-checkout.
    payload_signing_key: SecretStr = SecretStr("dev-only-change-me")

    # Admin API: maps API key -> role. Provided as JSON in UMIP_ADMIN_API_KEYS.
    admin_api_keys: dict[str, str] = Field(default_factory=dict)

    # Market data
    market_data_provider: str = "mock"  # mock | massive
    massive_api_key: SecretStr | None = None
    massive_base_url: str = "https://api.massive.com"
    max_quote_age_seconds: int = 15
    max_chain_age_seconds: int = 60

    # Signals
    publish_mode: PublishMode = PublishMode.HUMAN_APPROVAL

    # AI (optional; the quant engine never depends on it)
    anthropic_api_key: SecretStr | None = None
    ai_model: str = "claude-opus-5-5"

    # Membership
    invite_link_ttl_seconds: int = 900
    expiry_grace_hours: int = 0
    renewal_reminder_days: list[int] = Field(default_factory=lambda: [3, 1])

    def require_production_safety(self) -> list[str]:
        """Return a list of problems that must be fixed before running in prod."""
        problems: list[str] = []
        if self.env == Environment.PROD:
            if self.payload_signing_key.get_secret_value() == "dev-only-change-me":
                problems.append("UMIP_PAYLOAD_SIGNING_KEY must be set")
            if not self.telegram_webhook_secret:
                problems.append("UMIP_TELEGRAM_WEBHOOK_SECRET must be set")
            if self.market_data_provider == "mock":
                problems.append("mock market data cannot be used in prod")
            if self.telegram_use_test_env:
                problems.append("telegram test environment enabled in prod")
            if self.database_url.startswith("sqlite"):
                problems.append("use PostgreSQL in prod")
        return problems


@lru_cache
def get_settings() -> Settings:
    return Settings()
