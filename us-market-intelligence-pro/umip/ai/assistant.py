"""Subscriber-facing AI research assistant.

Grounding rules:
- The model can only see data through read-only tools; each tool result carries
  ``source`` and ``as_of``.
- After the model answers, every number in the answer must appear in some tool
  result (or the user's question). Otherwise the answer is withheld.
- Per-user daily quota by plan.
"""

from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from umip.ai.agents import Capability, require
from umip.models import AIUsage
from umip.timeutil import NY, utcnow

SYSTEM_PROMPT = """You are the research assistant of "US Market Intelligence Pro", answering \
subscribers in the language they write in (Arabic by default).

You explain published signals, support/resistance, economic events, option risks, why an \
opportunity was cancelled, and session summaries.

Ground every factual statement in tool results. Quote prices, levels, times and probabilities \
only if a tool returned them, and say the source and the as-of time. If the data you need is not \
available from a tool, say so plainly rather than estimating. Do not give personalised investment \
advice, position sizing for the user's account, or predictions presented as certain; you may \
explain the published plan and its risks. Keep answers short and structured."""

TOOLS: list[dict] = [
    {"name": "get_signal", "description": "Fetch a published signal by its reference (e.g. "
     "UM-260309-ABC123): original plan, status and full status history.",
     "input_schema": {"type": "object", "properties": {"ref": {"type": "string"}},
                      "required": ["ref"], "additionalProperties": False}, "strict": True},
    {"name": "list_open_signals", "description": "List currently open published signals.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
     "strict": True},
    {"name": "get_quote", "description": "Latest quote for a US symbol with source and as-of "
     "time. Fails if the data is stale.",
     "input_schema": {"type": "object", "properties": {"symbol": {"type": "string"}},
                      "required": ["symbol"], "additionalProperties": False}, "strict": True},
    {"name": "get_economic_events", "description": "Scheduled US macro events for the next N days.",
     "input_schema": {"type": "object", "properties": {"days": {"type": "integer"}},
                      "required": ["days"], "additionalProperties": False}, "strict": True},
]

TOOL_CAPS = {"get_signal": Capability.READ_SIGNALS, "list_open_signals": Capability.READ_SIGNALS,
             "get_quote": Capability.READ_MARKET, "get_economic_events": Capability.READ_EVENTS}

ToolFn = Callable[[dict], Awaitable[Any]]

_NUM = re.compile(r"(?<![\w.])-?\d[\d,]*(?:\.\d+)?")
_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def _numbers(text: str) -> set[str]:
    out = set()
    for m in _NUM.findall(text.translate(_AR_DIGITS)):
        n = m.replace(",", "")
        try:
            out.add(f"{float(n):g}")
        except ValueError:
            pass
    return out


def ungrounded_numbers(answer: str, evidence: list[str], allow: set[str] | None = None) -> set[str]:
    """Numbers in ``answer`` that appear in no evidence. Small integers (list
    numbering, '1:2' etc.) are allowed."""
    known = set().union(*(_numbers(e) for e in evidence)) if evidence else set()
    known |= allow or set()
    return {n for n in _numbers(answer) if n not in known and not (n.isdigit() and int(n) <= 10)}


class QuotaExceeded(RuntimeError):
    pass


async def consume_quota(session: AsyncSession, user_id: int, daily_limit: int,
                        now: datetime | None = None) -> int:
    day = (now or utcnow()).astimezone(NY).date().isoformat()
    row = await session.scalar(select(AIUsage).where(AIUsage.user_id == user_id, AIUsage.day == day))
    if row is None:
        row = AIUsage(user_id=user_id, day=day, count=0)
        session.add(row)
    if row.count >= daily_limit:
        raise QuotaExceeded("daily assistant limit reached")
    row.count += 1
    await session.commit()
    return daily_limit - row.count


@dataclass
class AssistantResult:
    text: str
    grounded: bool
    tool_calls: list[str] = field(default_factory=list)
    refused: bool = False


WITHHELD = {
    "ar": "تعذّر التحقق من بعض الأرقام في الإجابة من مصادر البيانات، لذلك لم تُعرض. "
          "يرجى إعادة صياغة السؤال أو مراجعة تفاصيل الإشارة.",
    "en": "Some figures in the answer could not be verified against our data, so it was "
          "withheld. Please rephrase or check the signal details.",
}


class ResearchAssistant:
    """``client`` is an ``anthropic.AsyncAnthropic`` (or a test double with the
    same ``beta.messages.create`` surface)."""

    def __init__(self, client, tools: dict[str, ToolFn], model: str = "claude-opus-5-5",
                 max_turns: int = 6):
        for name in tools:
            require("assistant", TOOL_CAPS[name])
        self.client = client
        self.tools = tools
        self.model = model
        self.max_turns = max_turns

    async def ask(self, question: str, lang: str = "ar") -> AssistantResult:
        messages: list[dict] = [{"role": "user", "content": question}]
        evidence: list[str] = []
        calls: list[str] = []
        tool_defs = [t for t in TOOLS if t["name"] in self.tools]
        for _ in range(self.max_turns):
            resp = await self.client.beta.messages.create(
                model=self.model, max_tokens=4000, system=SYSTEM_PROMPT, tools=tool_defs,
                messages=messages, output_config={"effort": "medium"},
                betas=["server-side-fallback-2026-07-01"], fallbacks="default")
            if resp.stop_reason == "refusal":
                return AssistantResult(WITHHELD[lang], False, calls, refused=True)
            messages.append({"role": "assistant", "content": resp.content})
            if resp.stop_reason != "tool_use":
                text = "".join(b.text for b in resp.content if b.type == "text").strip()
                bad = ungrounded_numbers(text, evidence, _numbers(question))
                if bad:
                    return AssistantResult(WITHHELD[lang], False, calls)
                return AssistantResult(text, True, calls)
            results = []
            for block in resp.content:
                if block.type != "tool_use":
                    continue
                calls.append(block.name)
                fn = self.tools.get(block.name)
                try:
                    if fn is None:
                        raise PermissionError(f"tool {block.name} not available")
                    out = json.dumps(await fn(dict(block.input)), default=str, ensure_ascii=False)
                    evidence.append(out)
                    results.append({"type": "tool_result", "tool_use_id": block.id, "content": out})
                except Exception as e:  # noqa: BLE001 - surfaced to the model as a tool error
                    results.append({"type": "tool_result", "tool_use_id": block.id,
                                    "content": f"error: {e}", "is_error": True})
            messages.append({"role": "user", "content": results})
        return AssistantResult(WITHHELD[lang], False, calls)
