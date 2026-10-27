from __future__ import annotations

import io
from dataclasses import dataclass, field
from typing import Any

import pytest
from pypdf import PdfWriter

from tenderpilot.analyzer import TenderAnalyzer
from tenderpilot.config import Settings
from tenderpilot.llm import LLMResult
from tenderpilot.models import (
    CompanyProfile,
    FitAssessment,
    Guarantee,
    Requirement,
    RequirementAssessment,
    Risk,
    SourceRef,
    TenderExtraction,
    UsageRecord,
)


def src(quote: str, page: int | None = 1) -> SourceRef:
    return SourceRef(page=page, clause=None, quote=quote)


@pytest.fixture
def extraction() -> TenderExtraction:
    return TenderExtraction(
        tender_title="تشغيل وصيانة مباني الإدارة العامة",
        issuing_entity="أمانة منطقة الرياض",
        tender_reference="2026-OM-114",
        submission_deadline="1448/05/10",
        estimated_value_sar=12_000_000,
        contract_duration="36 شهراً",
        scope_summary="تشغيل وصيانة وقائية وتصحيحية لعشرة مبانٍ إدارية.",
        requirements=[
            Requirement(id="R1", category="technical", text="خطة صيانة وقائية", mandatory=False, source=src("خطة الصيانة الوقائية")),
            Requirement(id="R2", category="certification", text="شهادة ISO 9001", mandatory=True, source=src("شهادة الأيزو")),
            Requirement(id="R3", category="experience", text="3 مشاريع مماثلة", mandatory=False, source=src("ثلاثة مشاريع مماثلة")),
            Requirement(id="R4", category="administrative", text="سجل تجاري ساري", mandatory=True, source=src("سجل تجاري")),
        ],
        guarantees=[Guarantee(type="bid_bond", description="ضمان ابتدائي", percentage=1, source=src("الضمان الابتدائي"))],
        evaluation_criteria=[],
        risks=[
            Risk(id="K1", title="غرامات تأخير", description="غرامة يومية", category="contractual",
                 likelihood="medium", impact="high", mitigation="جدولة دقيقة", source=src("غرامة تأخير")),
        ],
        disqualification_triggers=[],
        key_dates=[],
        clarification_questions=["هل تشمل الصيانة قطع الغيار؟"],
    )


@pytest.fixture
def profile() -> CompanyProfile:
    return CompanyProfile(name="شركة الإتقان", certifications=["ISO 9001"], max_single_contract_sar=10_000_000)


def fit(**statuses: str) -> FitAssessment:
    return FitAssessment(
        assessments=[
            RequirementAssessment(requirement_id=k, status=v, evidence="—", gap_action=None)  # type: ignore[arg-type]
            for k, v in statuses.items()
        ],
        strengths=[],
        capacity_notes="",
    )


def usage(task: str) -> UsageRecord:
    return UsageRecord(task=task, model="claude-opus-5-5", input_tokens=10,
                       cache_read_input_tokens=0, cache_creation_input_tokens=0, output_tokens=5)


@dataclass
class FakeLLM:
    responses: dict[str, Any]
    calls: list[dict[str, Any]] = field(default_factory=list)
    settings: Settings = field(default_factory=Settings.from_env)

    def structured(self, *, task, system, content, schema):
        self.calls.append({"task": task, "system": system, "content": content, "schema": schema})
        return LLMResult(data=self.responses[task], usage=usage(task))


@pytest.fixture
def blank_pdf() -> bytes:
    w = PdfWriter()
    w.add_blank_page(width=595, height=842)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


@pytest.fixture
def make_analyzer():
    def _make(responses: dict[str, Any]) -> tuple[TenderAnalyzer, FakeLLM]:
        llm = FakeLLM(responses)
        return TenderAnalyzer(settings=llm.settings, llm=llm), llm  # type: ignore[arg-type]

    return _make
