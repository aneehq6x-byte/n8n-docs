from __future__ import annotations

from umip.config import Settings
from umip.market_data.base import MarketDataProvider


def build_provider(settings: Settings) -> MarketDataProvider:
    if settings.market_data_provider == "massive":
        from umip.market_data.massive import MassiveProvider
        if settings.massive_api_key is None:
            raise SystemExit("UMIP_MASSIVE_API_KEY is required for the massive provider")
        return MassiveProvider(settings.massive_api_key.get_secret_value(), settings.massive_base_url)
    from umip.market_data.mock import MockProvider
    return MockProvider()
