"""Data contracts.

Classes under "LLM output schemas" are passed to the API as structured-output
schemas, so they stick to plain types (str, bool, number, list, Literal,
nested models) and carry descriptions that double as extraction instructions.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# --------------------------------------------------------------------------
# LLM output schemas — step 1: tender extraction
# --------------------------------------------------------------------------

RequirementCategory = Literal[
    "technical",
    "experience",
    "certification",
    "staffing",
    "financial",
    "administrative",
    "local_content",
]
Level = Literal["low", "medium", "high"]


class SourceRef(BaseModel):
    page: int | None = Field(description="1-based PDF page number where the quote appears.")
    clause: str | None = Field(description="Clause or section number as printed, e.g. '5.2.1'.")
    quote: str = Field(
        description="Short verbatim excerpt (max ~25 words) copied exactly from the document, "
        "in its original language. Never paraphrase."
    )


class Requirement(BaseModel):
    id: str = Field(description="Sequential id: R1, R2, ...")
    category: RequirementCategory
    text: str = Field(description="The requirement restated clearly in Arabic.")
    mandatory: bool = Field(description="True if failing it disqualifies the bid.")
    source: SourceRef


class Guarantee(BaseModel):
    type: Literal["bid_bond", "performance_bond", "advance_payment", "other"]
    description: str
    percentage: float | None = Field(description="Percent of contract/bid value, if stated.")
    source: SourceRef


class EvaluationCriterion(BaseModel):
    criterion: str
    weight_percent: float | None
    source: SourceRef


class Risk(BaseModel):
    id: str = Field(description="Sequential id: K1, K2, ...")
    title: str
    description: str
    category: Literal["delivery", "financial", "contractual", "compliance", "schedule", "technical"]
    likelihood: Level
    impact: Level
    mitigation: str
    source: SourceRef


class DisqualificationTrigger(BaseModel):
    description: str = Field(description="A formal/administrative condition that leads to exclusion.")
    source: SourceRef


class KeyDate(BaseModel):
    label: str
    date_text: str = Field(description="Date exactly as written in the document.")
    source: SourceRef


class TenderExtraction(BaseModel):
    tender_title: str
    issuing_entity: str
    tender_reference: str | None
    submission_deadline: str | None
    estimated_value_sar: float | None = Field(
        description="Estimated value in SAR only if the document states it; otherwise null."
    )
    contract_duration: str | None
    scope_summary: str = Field(description="3-6 sentence Arabic summary of the scope of work.")
    requirements: list[Requirement]
    guarantees: list[Guarantee]
    evaluation_criteria: list[EvaluationCriterion]
    risks: list[Risk]
    disqualification_triggers: list[DisqualificationTrigger]
    key_dates: list[KeyDate]
    clarification_questions: list[str] = Field(
        description="Ambiguities worth raising with the issuing entity during the inquiry period."
    )


# --------------------------------------------------------------------------
# LLM output schemas — step 2: company-fit assessment
# --------------------------------------------------------------------------

MatchStatus = Literal["met", "partial", "unmet", "unknown"]


class RequirementAssessment(BaseModel):
    requirement_id: str
    status: MatchStatus = Field(
        description="'unknown' when the profile has no information either way — never guess 'met'."
    )
    evidence: str = Field(description="Which profile facts support the status (Arabic).")
    gap_action: str | None = Field(description="Concrete step to close the gap, if not met.")


class FitAssessment(BaseModel):
    assessments: list[RequirementAssessment]
    strengths: list[str]
    capacity_notes: str = Field(description="Delivery capacity observations (team, financials, regions).")


# --------------------------------------------------------------------------
# Inputs
# --------------------------------------------------------------------------


class PastProject(BaseModel):
    title: str
    client: str | None = None
    value_sar: float | None = None
    year: int | None = None
    description: str | None = None


class CompanyProfile(BaseModel):
    name: str
    activities: list[str] = []
    classifications: list[str] = Field(default=[], description="e.g. contractor classification grades")
    certifications: list[str] = []
    past_projects: list[PastProject] = []
    team_size: int | None = None
    key_staff: list[str] = []
    annual_revenue_sar: float | None = None
    max_single_contract_sar: float | None = Field(
        default=None, description="Largest contract value the company can carry."
    )
    regions: list[str] = []
    local_content_percent: float | None = None


# --------------------------------------------------------------------------
# Computed outputs
# --------------------------------------------------------------------------

VerificationStatus = Literal["exact", "fuzzy", "not_found", "unavailable"]


class SourceCheck(BaseModel):
    item_id: str
    status: VerificationStatus


class VerificationReport(BaseModel):
    text_layer_available: bool
    checked: int
    verified: int
    checks: list[SourceCheck]

    @property
    def ratio(self) -> float | None:
        if not self.text_layer_available or self.checked == 0:
            return None
        return self.verified / self.checked


class ScoreFactor(BaseModel):
    label: str
    impact: float = Field(description="Signed contribution in score points.")
    detail: str


class OpportunityScore(BaseModel):
    score: int
    recommendation: Literal["go", "review", "no_go"]
    confidence: Level
    factors: list[ScoreFactor]
    blocking_gaps: list[str]


class UsageRecord(BaseModel):
    task: str
    model: str
    input_tokens: int
    cache_read_input_tokens: int
    cache_creation_input_tokens: int
    output_tokens: int


class AnalysisResult(BaseModel):
    extraction: TenderExtraction
    verification: VerificationReport
    fit: FitAssessment | None = None
    score: OpportunityScore | None = None
    usage: list[UsageRecord] = []


# --------------------------------------------------------------------------
# Bid writer — LLM output schema
# --------------------------------------------------------------------------

SectionKey = Literal[
    "understanding", "methodology", "implementation", "staffing", "quality", "hse", "local_content"
]


class ProposalSection(BaseModel):
    key: SectionKey
    title: str
    paragraphs: list[str] = Field(description="Formal Arabic paragraphs. Missing facts as [يُستكمل: ...].")
    addresses: list[str] = Field(description="Requirement ids (R1, R2, ...) this section responds to.")


class Phase(BaseModel):
    name: str
    duration_weeks: int | None = Field(description="Only if derivable from the tender; otherwise null.")
    activities: list[str]
    deliverables: list[str]


class StaffRole(BaseModel):
    role: str
    count: int | None
    responsibilities: str
    qualifications: str = Field(description="As required by the tender; never invent named people.")
    requirement_ids: list[str]


class QualityControl(BaseModel):
    area: str
    control: str
    frequency: str
    kpi: str


class ProposalDraft(BaseModel):
    executive_summary: list[str] = Field(description="2-4 Arabic paragraphs.")
    sections: list[ProposalSection]
    implementation_plan: list[Phase]
    staffing: list[StaffRole]
    quality_plan: list[QualityControl]


# --------------------------------------------------------------------------
# Bid writer — computed output
# --------------------------------------------------------------------------


class ComplianceRow(BaseModel):
    requirement_id: str
    text: str
    mandatory: bool
    sections: list[str]
    status: MatchStatus | None


class Proposal(BaseModel):
    tender_title: str
    issuing_entity: str
    tender_reference: str | None
    company_name: str
    draft: ProposalDraft
    compliance: list[ComplianceRow]
    placeholders: list[str] = Field(description="Facts the bid team must fill in before submission.")
    uncovered_mandatory: list[str] = Field(description="Mandatory requirements no section addresses.")
    usage: list[UsageRecord] = []


class ProposalRequest(BaseModel):
    analysis: AnalysisResult
    profile: CompanyProfile
    notes: str | None = Field(default=None, description="Bid team guidance: approach, partners, emphasis.")
