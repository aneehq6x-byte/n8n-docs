"""Runtime settings, read from environment variables (prefix ``TP_``).

Model routing is per task: each pipeline step has its own model, effort and
output budget, so a step can be moved to a different model or effort level
without code changes once evals show quality holds.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Literal

Effort = Literal["low", "medium", "high", "xhigh", "max"]
Provider = Literal["anthropic", "foundry"]

DEFAULT_MODEL = "claude-opus-5-5"


@dataclass(frozen=True)
class Route:
    model: str
    effort: Effort
    max_tokens: int


def _route(task: str, effort: Effort, max_tokens: int) -> Route:
    prefix = f"TP_{task.upper()}_"
    return Route(
        model=os.getenv(prefix + "MODEL", os.getenv("TP_MODEL", DEFAULT_MODEL)),
        effort=os.getenv(prefix + "EFFORT", effort),  # type: ignore[arg-type]
        max_tokens=int(os.getenv(prefix + "MAX_TOKENS", max_tokens)),
    )


@dataclass(frozen=True)
class Settings:
    provider: Provider = "anthropic"
    # Microsoft Foundry resource name (provider=foundry), for in-Azure deployments.
    foundry_resource: str | None = None
    # Server-side refusal fallbacks are a Claude API feature; Foundry needs them off.
    enable_fallbacks: bool = True
    max_upload_mb: int = 32
    max_pages: int = 600
    routes: dict[str, Route] = field(default_factory=dict)

    @classmethod
    def from_env(cls) -> "Settings":
        provider: Provider = os.getenv("TP_PROVIDER", "anthropic")  # type: ignore[assignment]
        return cls(
            provider=provider,
            foundry_resource=os.getenv("TP_FOUNDRY_RESOURCE"),
            enable_fallbacks=os.getenv("TP_ENABLE_FALLBACKS", "true").lower() == "true"
            and provider == "anthropic",
            max_upload_mb=int(os.getenv("TP_MAX_UPLOAD_MB", 32)),
            max_pages=int(os.getenv("TP_MAX_PAGES", 600)),
            routes={
                # Reading a long Arabic tender and extracting every obligation is the
                # quality-critical step.
                "extract": _route("extract", "high", 64000),
                # Matching a short requirement list against a company profile.
                "assess": _route("assess", "medium", 32000),
            },
        )

    def route(self, task: str) -> Route:
        return self.routes[task]
