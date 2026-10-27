"""Pipeline: PDF → extraction (LLM) → source verification → fit (LLM) → score (code)."""

from __future__ import annotations

import json

from .config import Settings
from .llm import LLMClient
from .models import (
    AnalysisResult,
    CompanyProfile,
    FitAssessment,
    TenderExtraction,
)
from .pdf import TenderDocument, load_pdf
from .prompts import ASSESS_SYSTEM, EXTRACT_SYSTEM, EXTRACT_USER
from .scoring import compute_score
from .verify import verify_sources


class TenderAnalyzer:
    def __init__(self, settings: Settings | None = None, llm: LLMClient | None = None):
        self.settings = settings or Settings.from_env()
        self.llm = llm or LLMClient(self.settings)

    def load(self, data: bytes) -> TenderDocument:
        return load_pdf(data, max_mb=self.settings.max_upload_mb, max_pages=self.settings.max_pages)

    def analyze(self, pdf_bytes: bytes, profile: CompanyProfile | None = None) -> AnalysisResult:
        doc = self.load(pdf_bytes)
        extracted = self.llm.structured(
            task="extract",
            system=EXTRACT_SYSTEM,
            content=[
                {
                    "type": "document",
                    "source": {"type": "base64", "media_type": "application/pdf", "data": doc.base64()},
                    # Re-analysis of the same tender (retries, profile changes) reuses the cache.
                    "cache_control": {"type": "ephemeral"},
                },
                {"type": "text", "text": EXTRACT_USER},
            ],
            schema=TenderExtraction,
        )
        extraction = extracted.data
        result = AnalysisResult(
            extraction=extraction,
            verification=verify_sources(extraction, doc),
            usage=[extracted.usage],
        )
        if profile is None or not extraction.requirements:
            return result

        assessed = self.llm.structured(
            task="assess",
            system=ASSESS_SYSTEM,
            content=[{"type": "text", "text": _assess_input(extraction, profile)}],
            schema=FitAssessment,
        )
        result.fit = assessed.data
        result.usage.append(assessed.usage)
        result.score = compute_score(extraction, assessed.data, profile, result.verification)
        return result


def _assess_input(extraction: TenderExtraction, profile: CompanyProfile) -> str:
    reqs = [
        {"id": r.id, "category": r.category, "mandatory": r.mandatory, "text": r.text}
        for r in extraction.requirements
    ]
    return (
        "<requirements>\n"
        + json.dumps(reqs, ensure_ascii=False, indent=1)
        + "\n</requirements>\n\n<company_profile>\n"
        + profile.model_dump_json(indent=1, exclude_none=True)
        + "\n</company_profile>"
    )
