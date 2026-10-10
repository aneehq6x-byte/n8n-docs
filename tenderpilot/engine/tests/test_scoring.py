from tenderpilot.models import VerificationReport
from tenderpilot.scoring import BLOCKED_CAP, compute_score

from conftest import fit

VERIFIED = VerificationReport(text_layer_available=True, checked=10, verified=10, checks=[])


def test_all_met_within_capacity_is_go(extraction, profile):
    profile.max_single_contract_sar = 50_000_000
    s = compute_score(extraction, fit(R1="met", R2="met", R3="met", R4="met"), profile, VERIFIED)
    assert s.score == 100
    assert s.recommendation == "go"
    assert s.confidence == "high"
    assert not s.blocking_gaps


def test_mandatory_unmet_caps_score_and_blocks(extraction, profile):
    profile.max_single_contract_sar = 50_000_000
    s = compute_score(extraction, fit(R1="met", R2="unmet", R3="met", R4="met"), profile, VERIFIED)
    assert s.score <= BLOCKED_CAP
    assert s.recommendation == "no_go"
    assert s.blocking_gaps and s.blocking_gaps[0].startswith("R2")


def test_capacity_penalty_is_explained(extraction, profile):
    # 12M tender vs 10M capacity → ratio 1.2 → 7-point penalty
    s = compute_score(extraction, fit(R1="met", R2="met", R3="met", R4="met"), profile, VERIFIED)
    assert s.score == 93
    assert any(f.label == "القدرة المالية" and f.impact == -7 for f in s.factors)


def test_unknowns_lower_confidence_and_force_review(extraction, profile):
    profile.max_single_contract_sar = None
    s = compute_score(extraction, fit(R1="unknown", R2="met", R3="unknown", R4="met"), profile, VERIFIED)
    assert s.confidence == "low"
    assert s.recommendation in ("review", "no_go")


def test_missing_assessment_counts_as_unknown(extraction, profile):
    s = compute_score(extraction, fit(R2="met", R4="met"), profile, VERIFIED)
    assert s.confidence == "low"


def test_factor_impacts_reconcile_with_score(extraction, profile):
    profile.max_single_contract_sar = None
    s = compute_score(extraction, fit(R1="partial", R2="met", R3="unmet", R4="met"), profile, VERIFIED)
    assert round(100 + sum(f.impact for f in s.factors)) == s.score
