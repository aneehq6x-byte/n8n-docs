"""Thin wrapper over the Anthropic SDK for schema-constrained calls.

Every call: frozen, cached system prompt; structured output validated against a
Pydantic model; streaming (long inputs/outputs); explicit effort; refusal and
truncation surfaced as typed errors; token usage recorded per task.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Generic, TypeVar

import anthropic
from pydantic import BaseModel

from .config import Settings
from .models import UsageRecord

log = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

FALLBACK_BETA = "server-side-fallback-2026-07-01"


class LLMError(RuntimeError):
    """The model call finished but produced no usable result."""


class RefusalError(LLMError):
    pass


class TruncatedError(LLMError):
    pass


@dataclass
class LLMResult(Generic[T]):
    data: T
    usage: UsageRecord


def build_client(settings: Settings) -> anthropic.Anthropic:
    if settings.provider == "foundry":
        # Keeps tender data inside the customer's Azure tenancy.
        return anthropic.AnthropicFoundry(resource=settings.foundry_resource)
    return anthropic.Anthropic()


class LLMClient:
    def __init__(self, settings: Settings, client: anthropic.Anthropic | None = None):
        self.settings = settings
        self.client = client or build_client(settings)

    def structured(
        self, *, task: str, system: str, content: list[dict[str, Any]], schema: type[T]
    ) -> LLMResult[T]:
        route = self.settings.route(task)
        kwargs: dict[str, Any] = {}
        if self.settings.enable_fallbacks:
            kwargs = {"betas": [FALLBACK_BETA], "fallbacks": "default"}

        with self.client.beta.messages.stream(
            model=route.model,
            max_tokens=route.max_tokens,
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": content}],
            output_format=schema,
            output_config={"effort": route.effort},
            **kwargs,
        ) as stream:
            message = stream.get_final_message()

        u = message.usage
        usage = UsageRecord(
            task=task,
            model=message.model,
            input_tokens=u.input_tokens,
            cache_read_input_tokens=u.cache_read_input_tokens or 0,
            cache_creation_input_tokens=u.cache_creation_input_tokens or 0,
            output_tokens=u.output_tokens,
        )
        log.info("llm task=%s request_id=%s usage=%s", task, message._request_id, usage.model_dump())

        if message.stop_reason == "refusal":
            category = message.stop_details.category if message.stop_details else None
            raise RefusalError(f"{task}: the model declined the request (category={category}).")
        if message.stop_reason in ("max_tokens", "model_context_window_exceeded"):
            raise TruncatedError(
                f"{task}: output hit max_tokens={route.max_tokens}; raise TP_{task.upper()}_MAX_TOKENS."
            )
        if message.parsed_output is None:
            raise LLMError(f"{task}: response did not match the expected schema.")
        return LLMResult(data=message.parsed_output, usage=usage)
