import json

from tenderpilot.evals import GoldBrief, render, run, score_tender, similarity
from tenderpilot.models import AnalysisResult, DisqualificationTrigger, VerificationReport

from conftest import FakeLLM, src

UNVERIFIED = VerificationReport(text_layer_available=False, checked=0, verified=0, checks=[])


def test_similarity_tolerates_arabic_variation():
    # Different article/conjunction prefixes, hamza and diacritics still match.
    assert similarity("تقديم شهادة الأيزو 9001", "يجب على المتنافس تقديم شهادةِ أيزو 9001 سارية") >= 0.75
    assert similarity("سجل تجاري ساري المفعول", "خطة الصيانة الوقائية") < 0.5


def gold(**kw):
    return GoldBrief.model_validate(kw)


def test_score_counts_misses_and_flags(extraction):
    extraction.disqualification_triggers = [
        DisqualificationTrigger(description="عدم تقديم الضمان الابتدائي", source=src("الضمان الابتدائي"))
    ]
    result = AnalysisResult(extraction=extraction, verification=UNVERIFIED)
    g = gold(
        requirements=[
            {"text": "شهادة ISO 9001", "mandatory": True},
            {"text": "سجل تجاري ساري", "mandatory": True},
            {"text": "خطة صيانة وقائية", "mandatory": True},  # extracted as non-mandatory
            {"text": "شهادة الدفاع المدني", "mandatory": True},  # not extracted
        ],
        disqualification_triggers=["عدم تقديم الضمان الابتدائي", "تقديم العرض بعد الموعد"],
    )
    s = score_tender("t1", g, result)
    assert (s.found_mandatory, s.gold_mandatory) == (3, 4)
    assert s.mandatory_flag_correct == 2
    assert (s.triggers_found, s.triggers_total) == (1, 2)
    assert "[إلزامي] شهادة الدفاع المدني" in s.misses

    report, passed = render([s], target=0.9)
    assert not passed and "75%" in report and "شهادة الدفاع المدني" in report


def test_run_caches_analysis(tmp_path, extraction, blank_pdf, make_analyzer):
    (tmp_path / "t1.pdf").write_bytes(blank_pdf)
    (tmp_path / "t1.gold.json").write_text(
        json.dumps({"requirements": [{"text": "شهادة ISO 9001", "mandatory": True}]}, ensure_ascii=False),
        encoding="utf-8",
    )
    analyzer, llm = make_analyzer({"extract": extraction})
    report, passed = run(tmp_path, analyzer, target=0.9)
    assert passed and (tmp_path / "t1.analysis.json").exists()
    run(tmp_path, analyzer, target=0.9)
    assert len(llm.calls) == 1  # second run reads the cache
