"""Opportunity Score (0-100): computed in code from the model's per-requirement
assessments, so every point is traceable to a factor shown to the user.

The model judges *whether* a requirement is met; this module decides *how much
that matters*. Weights live here, under version control, not in a prompt.
"""

from __future__ import annotations

from collections import defaultdict

from .models import (
    CompanyProfile,
    FitAssessment,
    OpportunityScore,
    ScoreFactor,
    TenderExtraction,
    VerificationReport,
)

CATEGORY_WEIGHTS: dict[str, float] = {
    "technical": 0.30,
    "experience": 0.20,
    "certification": 0.15,
    "staffing": 0.10,
    "financial": 0.10,
    "local_content": 0.10,
    "administrative": 0.05,
}
STATUS_VALUE = {"met": 1.0, "partial": 0.5, "unknown": 0.25, "unmet": 0.0}
MANDATORY_WEIGHT = 2.0
BLOCKED_CAP = 39  # a bid with a disqualifying gap can't score as a "go"
GO_THRESHOLD = 70
REVIEW_THRESHOLD = 50

CATEGORY_LABELS = {
    "technical": "المتطلبات الفنية",
    "experience": "الخبرات السابقة",
    "certification": "الشهادات والتصنيفات",
    "staffing": "الكوادر",
    "financial": "المتطلبات المالية",
    "local_content": "المحتوى المحلي",
    "administrative": "المتطلبات الإدارية",
}


def compute_score(
    extraction: TenderExtraction,
    fit: FitAssessment,
    profile: CompanyProfile,
    verification: VerificationReport,
) -> OpportunityScore:
    status_by_id = {a.requirement_id: a.status for a in fit.assessments}
    requirements = extraction.requirements

    # Weighted mean of requirement status, per category.
    sums: dict[str, float] = defaultdict(float)
    weights: dict[str, float] = defaultdict(float)
    blocking: list[str] = []
    unknown = 0
    for req in requirements:
        status = status_by_id.get(req.id, "unknown")
        unknown += status == "unknown"
        w = MANDATORY_WEIGHT if req.mandatory else 1.0
        sums[req.category] += w * STATUS_VALUE[status]
        weights[req.category] += w
        if req.mandatory and status == "unmet":
            blocking.append(f"{req.id}: {req.text}")

    factors: list[ScoreFactor] = []
    present = {c: CATEGORY_WEIGHTS[c] for c in weights}
    total_w = sum(present.values()) or 1.0
    base = 0.0
    for cat, cw in sorted(present.items(), key=lambda kv: -kv[1]):
        share = cw / total_w * 100  # points this category can contribute
        ratio = sums[cat] / weights[cat]
        earned = share * ratio
        base += earned
        factors.append(
            ScoreFactor(
                label=CATEGORY_LABELS[cat],
                impact=round(earned - share, 1),
                detail=f"استيفاء {ratio:.0%} من {share:.0f} نقطة ممكنة",
            )
        )
    if not requirements:
        base = 50.0

    score = base
    value, cap = extraction.estimated_value_sar, profile.max_single_contract_sar
    if value and cap:
        ratio = value / cap
        penalty = 15 if ratio > 1.5 else 7 if ratio > 1.0 else 0
        if penalty:
            score -= penalty
            factors.append(
                ScoreFactor(
                    label="القدرة المالية",
                    impact=-penalty,
                    detail=f"قيمة المنافسة {ratio:.1f}x من أكبر عقد تستطيع الشركة تحمّله",
                )
            )

    score = max(0.0, min(100.0, score))
    if blocking:
        if score > BLOCKED_CAP:
            factors.append(
                ScoreFactor(
                    label="متطلبات إلزامية غير مستوفاة",
                    impact=-(round(score) - BLOCKED_CAP),
                    detail=f"{len(blocking)} متطلب إلزامي قد يؤدي إلى الاستبعاد",
                )
            )
        score = min(score, BLOCKED_CAP)

    unknown_share = unknown / len(requirements) if requirements else 1.0
    v_ratio = verification.ratio
    if unknown_share > 0.3 or (v_ratio is not None and v_ratio < 0.6):
        confidence = "low"
    elif unknown_share > 0.1 or v_ratio is None or v_ratio < 0.85:
        confidence = "medium"
    else:
        confidence = "high"

    final = round(score)
    if blocking or final < REVIEW_THRESHOLD:
        recommendation = "no_go"
    elif final >= GO_THRESHOLD and confidence != "low":
        recommendation = "go"
    else:
        recommendation = "review"

    return OpportunityScore(
        score=final,
        recommendation=recommendation,
        confidence=confidence,
        factors=factors,
        blocking_gaps=blocking,
    )
