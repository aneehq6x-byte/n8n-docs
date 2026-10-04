"""PDF intake: size/page validation and per-page text for source verification."""

from __future__ import annotations

import base64
import io
from dataclasses import dataclass

from pypdf import PdfReader
from pypdf.errors import PdfReadError


class DocumentError(ValueError):
    """The uploaded file can't be analyzed (not a PDF, too large, too many pages)."""


@dataclass(frozen=True)
class TenderDocument:
    data: bytes
    page_texts: list[str]

    @property
    def page_count(self) -> int:
        return len(self.page_texts)

    @property
    def has_text_layer(self) -> bool:
        # Scanned tenders have no extractable text; the model still reads them
        # visually, but quotes can't be checked against a text layer.
        chars = sum(len(t.strip()) for t in self.page_texts)
        return chars >= 30 * max(1, self.page_count)

    def base64(self) -> str:
        return base64.standard_b64encode(self.data).decode("ascii")


def load_pdf(data: bytes, *, max_mb: int = 32, max_pages: int = 600) -> TenderDocument:
    if not data.startswith(b"%PDF"):
        raise DocumentError("الملف ليس PDF صالحاً.")
    if len(data) > max_mb * 1024 * 1024:
        raise DocumentError(f"حجم الملف يتجاوز الحد المسموح ({max_mb} ميغابايت).")
    try:
        reader = PdfReader(io.BytesIO(data))
        pages = reader.pages
        if len(pages) > max_pages:
            raise DocumentError(f"عدد الصفحات ({len(pages)}) يتجاوز الحد ({max_pages}).")
        texts = []
        for page in pages:
            try:
                texts.append(page.extract_text() or "")
            except Exception:  # noqa: BLE001 - one bad page shouldn't sink the document
                texts.append("")
    except PdfReadError as exc:
        raise DocumentError(f"تعذّرت قراءة ملف PDF: {exc}") from exc
    return TenderDocument(data=data, page_texts=texts)
