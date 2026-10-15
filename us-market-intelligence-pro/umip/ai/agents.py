"""Multi-agent roster with explicit, least-privilege permissions.

Decision-making agents (risk manager, validator) are deterministic code, not
LLMs. LLM-backed agents can only *read* through whitelisted tools and produce
text; none can publish, approve, change risk limits or edit strategies.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class Capability(StrEnum):
    READ_MARKET = "read_market"
    READ_SIGNALS = "read_signals"
    READ_EVENTS = "read_events"
    READ_PERFORMANCE = "read_performance"
    PROPOSE_CANDIDATE = "propose_candidate"  # enters the pipeline as CANDIDATE only
    VETO_SIGNAL = "veto_signal"
    VALIDATE_SIGNAL = "validate_signal"
    SEND_MESSAGES = "send_messages"  # via outbox only, already-approved content
    PROPOSE_RESEARCH = "propose_research"  # writes a report for humans; no prod changes


@dataclass(frozen=True)
class AgentSpec:
    key: str
    name: str
    implementation: str  # "deterministic" | "llm" | "hybrid"
    capabilities: frozenset[Capability]
    status: str  # implemented | planned


C = Capability
ROSTER: dict[str, AgentSpec] = {a.key: a for a in [
    AgentSpec("market_structure", "Market Structure Analyst", "deterministic",
              frozenset({C.READ_MARKET, C.PROPOSE_CANDIDATE}), "implemented (quant.strategies)"),
    AgentSpec("options", "Options Analyst", "deterministic",
              frozenset({C.READ_MARKET}), "implemented (options.selector)"),
    AgentSpec("economic", "Economic Intelligence", "hybrid",
              frozenset({C.READ_EVENTS}), "planned: needs licensed calendar source"),
    AgentSpec("geopolitical", "Geopolitical Intelligence", "llm",
              frozenset({C.READ_EVENTS}), "planned: needs licensed news source"),
    AgentSpec("stock_hunter", "Stock Opportunity Hunter", "hybrid",
              frozenset({C.READ_MARKET, C.PROPOSE_CANDIDATE}), "planned"),
    AgentSpec("risk_manager", "Risk Manager", "deterministic",
              frozenset({C.VETO_SIGNAL}), "implemented (risk.engine)"),
    AgentSpec("validator", "Signal Validator", "deterministic",
              frozenset({C.VALIDATE_SIGNAL, C.VETO_SIGNAL}), "implemented (signals.service)"),
    AgentSpec("auditor", "Performance Auditor", "deterministic",
              frozenset({C.READ_PERFORMANCE, C.READ_SIGNALS}), "implemented (performance.metrics)"),
    AgentSpec("telegram_ops", "Telegram Operations", "deterministic",
              frozenset({C.SEND_MESSAGES}), "implemented (notifications outbox)"),
    AgentSpec("research", "Research & Strategy Improvement", "hybrid",
              frozenset({C.READ_PERFORMANCE, C.PROPOSE_RESEARCH}), "partial (quant.backtest)"),
    AgentSpec("assistant", "AI Research Assistant", "llm",
              frozenset({C.READ_MARKET, C.READ_SIGNALS, C.READ_EVENTS}), "implemented (ai.assistant)"),
]}


def allowed(agent_key: str, cap: Capability) -> bool:
    spec = ROSTER.get(agent_key)
    return spec is not None and cap in spec.capabilities


def require(agent_key: str, cap: Capability) -> None:
    if not allowed(agent_key, cap):
        raise PermissionError(f"agent '{agent_key}' lacks capability '{cap}'")
