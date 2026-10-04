"""HTTP API. Run: ``uvicorn tenderpilot_analyzer.api:app``."""

from __future__ import annotations

import logging
from typing import Annotated, Literal

import anthropic
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import PlainTextResponse
from pydantic import ValidationError

from . import __version__
from .analyzer import TenderAnalyzer
from .llm import LLMError, RefusalError
from .models import AnalysisResult, CompanyProfile
from .pdf import DocumentError
from .report import render_markdown

log = logging.getLogger(__name__)


def create_app(analyzer: TenderAnalyzer | None = None) -> FastAPI:
    app = FastAPI(title="TenderPilot Tender Analyzer", version=__version__)
    state: dict[str, TenderAnalyzer] = {}

    def get_analyzer() -> TenderAnalyzer:
        # Built lazily so the app can start (and serve /healthz) without credentials.
        if "a" not in state:
            state["a"] = analyzer or TenderAnalyzer()
        return state["a"]

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

        try:
            result = a.analyze(data, profile)
        except DocumentError as exc:
            raise HTTPException(422, str(exc)) from exc
        except RefusalError as exc:
            raise HTTPException(422, str(exc)) from exc
        except LLMError as exc:
            raise HTTPException(502, str(exc)) from exc
        except anthropic.RateLimitError as exc:
            raise HTTPException(503, "الخدمة مشغولة حالياً، أعد المحاولة لاحقاً.") from exc
        except (anthropic.APIConnectionError, anthropic.InternalServerError) as exc:
            log.exception("upstream model error")
            raise HTTPException(502, "تعذّر الوصول إلى خدمة النموذج.") from exc

        if format == "markdown":
            return PlainTextResponse(render_markdown(result), media_type="text/markdown; charset=utf-8")
        return result

    return app


app = create_app()
