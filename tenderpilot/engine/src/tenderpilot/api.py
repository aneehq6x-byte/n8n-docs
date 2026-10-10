"""HTTP API. Run: ``uvicorn tenderpilot.api:app``."""

from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Annotated, Literal

import anthropic
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse, Response
from pydantic import ValidationError

from . import __version__
from .analyzer import TenderAnalyzer
from .docx_export import build_docx, review_notes
from .llm import LLMError, RefusalError
from .models import AnalysisResult, CompanyProfile, Proposal, ProposalRequest
from .pdf import DocumentError
from .report import render_markdown
from .writer import BidWriter, WriterError

log = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).with_name("static")
DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


@contextmanager
def _http_errors() -> Iterator[None]:
    """Map pipeline and upstream failures to HTTP status codes."""
    try:
        yield
    except (DocumentError, WriterError, RefusalError) as exc:
        raise HTTPException(422, str(exc)) from exc
    except LLMError as exc:
        raise HTTPException(502, str(exc)) from exc
    except anthropic.RateLimitError as exc:
        raise HTTPException(503, "الخدمة مشغولة حالياً، أعد المحاولة لاحقاً.") from exc
    except (anthropic.APIConnectionError, anthropic.InternalServerError) as exc:
        log.exception("upstream model error")
        raise HTTPException(502, "تعذّر الوصول إلى خدمة النموذج.") from exc


def create_app(analyzer: TenderAnalyzer | None = None, writer: BidWriter | None = None) -> FastAPI:
    app = FastAPI(title="TenderPilot Engine", version=__version__)
    state: dict[str, object] = {}

    # Built lazily so the app can start (and serve /healthz) without credentials.
    def get_analyzer() -> TenderAnalyzer:
        if "a" not in state:
            state["a"] = analyzer or TenderAnalyzer()
        return state["a"]  # type: ignore[return-value]

    def get_writer() -> BidWriter:
        if "w" not in state:
            state["w"] = writer or BidWriter()
        return state["w"]  # type: ignore[return-value]

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    @app.post("/v1/analyze", response_model=AnalysisResult)
    def analyze(
        file: Annotated[UploadFile, File(description="Tender document (PDF)")],
        company_profile: Annotated[str | None, Form(description="CompanyProfile as JSON")] = None,
        format: Annotated[Literal["json", "markdown"], Query()] = "json",
    ):
        a = get_analyzer()
        limit = a.settings.max_upload_mb * 1024 * 1024
        data = file.file.read(limit + 1)
        if len(data) > limit:
            raise HTTPException(413, f"الحد الأقصى لحجم الملف {a.settings.max_upload_mb} ميغابايت.")
        profile = None
        if company_profile:
            try:
                profile = CompanyProfile.model_validate_json(company_profile)
            except ValidationError as exc:
                raise HTTPException(422, f"ملف الشركة غير صالح: {exc.errors()}") from exc

        with _http_errors():
            result = a.analyze(data, profile)

        if format == "markdown":
            return PlainTextResponse(render_markdown(result), media_type="text/markdown; charset=utf-8")
        return result

    @app.post("/v1/report", response_class=PlainTextResponse)
    def report(result: AnalysisResult) -> PlainTextResponse:
        """Re-render the executive report from a stored analysis (no model call)."""
        return PlainTextResponse(render_markdown(result), media_type="text/markdown; charset=utf-8")

    @app.post("/v1/proposal", response_model=Proposal)
    def proposal(
        req: ProposalRequest,
        format: Annotated[Literal["json", "docx", "review"], Query()] = "json",
    ):
        """Draft the technical proposal from a stored analysis and the company profile."""
        with _http_errors():
            result = get_writer().write(req.analysis, req.profile, req.notes)
        if format == "docx":
            return Response(
                build_docx(result, req.analysis.extraction.risks),
                media_type=DOCX_TYPE,
                headers={"Content-Disposition": 'attachment; filename="technical-proposal.docx"'},
            )
        if format == "review":
            return PlainTextResponse(review_notes(result), media_type="text/markdown; charset=utf-8")
        return result

    @app.post("/v1/proposal/docx")
    def proposal_docx(result: Proposal, analysis: AnalysisResult) -> Response:
        """Re-render a stored proposal as Word without a model call."""
        return Response(build_docx(result, analysis.extraction.risks), media_type=DOCX_TYPE)

    @app.get("/", include_in_schema=False)
    def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    return app


app = create_app()
