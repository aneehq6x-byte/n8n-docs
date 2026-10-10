"""Bid writer: analysis + company profile → technical proposal draft.

The model drafts the prose; code builds the compliance matrix, collects the
placeholders the team must fill, and flags mandatory requirements no section
answers — so a reviewer sees what's missing before reading a word.
"""

from __future__ import annotations

import json
import re

from .config import Settings
from .llm import LLMClient
from .models import (
    AnalysisResult,
    CompanyProfile,
    ComplianceRow,
    Proposal,
    ProposalDraft,
)
from .prompts import WRITE_SYSTEM

PLACEHOLDER = re.compile(r"\[يُ?ستكمل:\s*([^\]]+)\]")


class WriterError(ValueError):
    """The analysis can't support a proposal (e.g. no requirements extracted)."""


class BidWriter:
    def __init__(self, settings: Settings | None = None, llm: LLMClient | None = None):
        self.settings = settings or Settings.from_env()
        self.llm = llm or LLMClient(self.settings)

    def write(
        self, analysis: AnalysisResult, profile: CompanyProfile, notes: str | None = None
    ) -> Proposal:
        ex = analysis.extraction
        if not ex.requirements:
            raise WriterError("لا توجد متطلبات مستخرجة في التحليل لبناء عرض عليها.")
        drafted = self.llm.structured(
            task="write",
            system=WRITE_SYSTEM,
            content=[{"type": "text", "text": _write_input(analysis, profile, notes)}],
            schema=ProposalDraft,
        )
        return assemble(analysis, profile, drafted.data, usage=[drafted.usage])


def assemble(
    analysis: AnalysisResult, profile: CompanyProfile, draft: ProposalDraft, usage=()
) -> Proposal:
    ex = analysis.extraction
    status = {a.requirement_id: a.status for a in analysis.fit.assessments} if analysis.fit else {}

    covered: dict[str, list[str]] = {}
    for section in draft.sections:
        for rid in section.addresses:
            covered.setdefault(rid, []).append(section.title)
    for role in draft.staffing:
        for rid in role.requirement_ids:
            covered.setdefault(rid, []).append("فريق العمل")

    compliance = [
        ComplianceRow(
            requirement_id=r.id,
            text=r.text,
            mandatory=r.mandatory,
            sections=list(dict.fromkeys(covered.get(r.id, []))),
            status=status.get(r.id),
        )
        for r in ex.requirements
    ]
    uncovered = [f"{c.requirement_id}: {c.text}" for c in compliance if c.mandatory and not c.sections]

    return Proposal(
        tender_title=ex.tender_title,
        issuing_entity=ex.issuing_entity,
        tender_reference=ex.tender_reference,
        company_name=profile.name,
        draft=draft,
        compliance=compliance,
        placeholders=_placeholders(draft),
        uncovered_mandatory=uncovered,
        usage=list(usage),
    )


def _placeholders(draft: ProposalDraft) -> list[str]:
    texts = list(draft.executive_summary)
    for s in draft.sections:
        texts += s.paragraphs
    for p in draft.implementation_plan:
        texts += [p.name, *p.activities, *p.deliverables]
    for r in draft.staffing:
        texts += [r.responsibilities, r.qualifications]
    for q in draft.quality_plan:
        texts += [q.control, q.kpi]
    found = (m.group(1).strip() for t in texts for m in PLACEHOLDER.finditer(t))
    return list(dict.fromkeys(found))


def _write_input(analysis: AnalysisResult, profile: CompanyProfile, notes: str | None) -> str:
    ex = analysis.extraction
    brief = {
        "tender_title": ex.tender_title,
        "issuing_entity": ex.issuing_entity,
        "contract_duration": ex.contract_duration,
        "scope_summary": ex.scope_summary,
        "requirements": [
            {"id": r.id, "category": r.category, "mandatory": r.mandatory, "text": r.text}
            for r in ex.requirements
        ],
        "evaluation_criteria": [
            {"criterion": c.criterion, "weight_percent": c.weight_percent}
            for c in ex.evaluation_criteria
        ],
        "risks": [{"title": k.title, "description": k.description} for k in ex.risks],
    }
    assessments = (
        [a.model_dump() for a in analysis.fit.assessments] if analysis.fit else "not assessed"
    )
    parts = [
        "<tender_brief>\n" + json.dumps(brief, ensure_ascii=False, indent=1) + "\n</tender_brief>",
        "<assessment>\n" + json.dumps(assessments, ensure_ascii=False, indent=1) + "\n</assessment>",
        "<company_profile>\n" + profile.model_dump_json(indent=1, exclude_none=True) + "\n</company_profile>",
    ]
    if notes:
        parts.append("<bid_team_guidance>\n" + notes + "\n</bid_team_guidance>")
    return "\n\n".join(parts)
