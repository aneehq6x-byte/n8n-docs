import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from tenderpilot_analyzer.api import create_app
from tenderpilot_analyzer.config import Settings
from tenderpilot_analyzer.llm import FALLBACK_BETA, LLMClient, RefusalError, TruncatedError
from tenderpilot_analyzer.models import TenderExtraction
from tenderpilot_analyzer.pdf import DocumentError
from tenderpilot_analyzer.report import render_markdown

from conftest import fit


def test_extraction_only_without_profile(make_analyzer, extraction, blank_pdf):
    analyzer, llm = make_analyzer({"extract": extraction})
    result = analyzer.analyze(blank_pdf)
    assert [c["task"] for c in llm.calls] == ["extract"]
    doc_block = llm.calls[0]["content"][0]
    assert doc_block["type"] == "document" and doc_block["source"]["media_type"] == "application/pdf"
    assert result.score is None
    # Blank PDF has no text layer → quotes can't be checked, and the report says so.
    assert not result.verification.text_layer_available
    assert "ممسوح ضوئياً" in render_markdown(result)


def test_full_pipeline_with_profile(make_analyzer, extraction, profile, blank_pdf):
    analyzer, llm = make_analyzer(
        {"extract": extraction, "assess": fit(R1="met", R2="met", R3="partial", R4="met")}
    )
    result = analyzer.analyze(blank_pdf, profile)
    assert [c["task"] for c in llm.calls] == ["extract", "assess"]
    assess_input = llm.calls[1]["content"][0]["text"]
    assert "<company_profile>" in assess_input and "R4" in assess_input
    assert result.score is not None and 0 <= result.score.score <= 100
    report = render_markdown(result)
    assert "Opportunity Score" in report and "مصفوفة المخاطر" in report


def test_rejects_non_pdf(make_analyzer, extraction):
    analyzer, _ = make_analyzer({"extract": extraction})
    with pytest.raises(DocumentError):
        analyzer.analyze(b"not a pdf")


# --- LLM client request shape and stop-reason handling -----------------------


class FakeStream:
    def __init__(self, message):
        self.message = message

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get_final_message(self):
        return self.message


def fake_message(stop_reason="end_turn", parsed=None):
    return SimpleNamespace(
        model="claude-opus-5-5",
        stop_reason=stop_reason,
        stop_details=SimpleNamespace(category="cyber") if stop_reason == "refusal" else None,
        parsed_output=parsed,
        _request_id="req_test",
        usage=SimpleNamespace(input_tokens=100, cache_read_input_tokens=80,
                              cache_creation_input_tokens=0, output_tokens=20),
    )


def make_client(message, captured):
    def stream(**kwargs):
        captured.update(kwargs)
        return FakeStream(message)

    return SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(stream=stream)))


def test_llm_request_uses_route_cache_schema_and_fallbacks(extraction):
    captured: dict = {}
    llm = LLMClient(Settings.from_env(), client=make_client(fake_message(parsed=extraction), captured))
    res = llm.structured(task="extract", system="SYS", content=[], schema=TenderExtraction)
    assert res.data is extraction and res.usage.cache_read_input_tokens == 80
    assert captured["model"] == "claude-opus-5-5"
    assert captured["output_config"] == {"effort": "high"}
    assert captured["output_format"] is TenderExtraction
    assert captured["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert captured["betas"] == [FALLBACK_BETA] and captured["fallbacks"] == "default"


def test_route_override_from_env(monkeypatch):
    monkeypatch.setenv("TP_ASSESS_EFFORT", "low")
    monkeypatch.setenv("TP_PROVIDER", "foundry")
    s = Settings.from_env()
    assert s.route("assess").effort == "low"
    assert s.enable_fallbacks is False  # server-side fallbacks are Claude API only


@pytest.mark.parametrize(
    "stop, exc", [("refusal", RefusalError), ("max_tokens", TruncatedError)]
)
def test_llm_stop_reasons_raise(stop, exc):
    llm = LLMClient(Settings.from_env(), client=make_client(fake_message(stop), {}))
    with pytest.raises(exc):
        llm.structured(task="extract", system="SYS", content=[], schema=TenderExtraction)


# --- HTTP API ----------------------------------------------------------------


def test_api_markdown_and_errors(make_analyzer, extraction, profile, blank_pdf):
    analyzer, _ = make_analyzer({"extract": extraction, "assess": fit(R1="met", R2="met", R3="met", R4="met")})
    client = TestClient(create_app(analyzer))

    assert client.get("/healthz").json()["status"] == "ok"

    r = client.post(
        "/v1/analyze?format=markdown",
        files={"file": ("t.pdf", blank_pdf, "application/pdf")},
        data={"company_profile": profile.model_dump_json()},
    )
    assert r.status_code == 200 and r.text.startswith("# تقرير تحليل المنافسة")

    r = client.post("/v1/analyze", files={"file": ("t.pdf", blank_pdf, "application/pdf")})
    assert r.status_code == 200 and r.json()["extraction"]["tender_reference"] == "2026-OM-114"

    # Stored analyses re-render without a model call; the demo UI uses this.
    rep = client.post("/v1/report", json=r.json())
    assert rep.status_code == 200 and "2026-OM-114" in rep.text

    ui = client.get("/")
    assert ui.status_code == 200 and 'dir="rtl"' in ui.text

    r = client.post("/v1/analyze", files={"file": ("t.txt", b"hello", "text/plain")})
    assert r.status_code == 422

    r = client.post(
        "/v1/analyze",
        files={"file": ("t.pdf", blank_pdf, "application/pdf")},
        data={"company_profile": json.dumps({"activities": []})},  # missing name
    )
    assert r.status_code == 422
