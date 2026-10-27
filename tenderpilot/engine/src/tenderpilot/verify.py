"""Check that every quote the model cites actually appears in the document.

Arabic PDF text layers are messy: presentation-form glyphs, diacritics, tatweel,
letter variants, and visual (reversed) word or letter order. We normalize both
sides and accept a quote if it matches exactly, or if most of its words occur
on the cited page (order-insensitive, tolerant of reversed words).
"""

from __future__ import annotations

import re
import unicodedata

from .models import SourceCheck, SourceRef, TenderExtraction, VerificationReport
from .pdf import TenderDocument

_DIACRITICS = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭ]")
_NON_WORD = re.compile(r"[^\w]+")
_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
_FUZZY_THRESHOLD = 0.8


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)  # folds presentation forms
    text = _DIACRITICS.sub("", text).replace("ـ", "")
    text = re.sub("[إأآٱ]", "ا", text).replace("ى", "ي").replace("ة", "ه")
    text = text.translate(_DIGITS).lower()
    return " ".join(_NON_WORD.sub(" ", text).split())


def _tokens(text: str) -> set[str]:
    words = text.split()
    return set(words) | {w[::-1] for w in words}


def check_quote(quote: str, pages: list[str], page: int | None) -> str:
    q = normalize(quote)
    if not q:
        return "not_found"
    candidates = [pages[page - 1]] if page and 1 <= page <= len(pages) else []
    candidates += pages  # fall back to the whole document if the page number is off
    for raw in candidates:
        if q in normalize(raw):
            return "exact"
    words = q.split()
    for raw in candidates:
        page_tokens = _tokens(normalize(raw))
        hits = sum(1 for w in words if w in page_tokens)
        if hits / len(words) >= _FUZZY_THRESHOLD:
            return "fuzzy"
    return "not_found"


def _cited_items(ex: TenderExtraction) -> list[tuple[str, SourceRef]]:
    items: list[tuple[str, SourceRef]] = []
    items += [(r.id, r.source) for r in ex.requirements]
    items += [(k.id, k.source) for k in ex.risks]
    items += [(f"G{i}", g.source) for i, g in enumerate(ex.guarantees, 1)]
    items += [(f"E{i}", c.source) for i, c in enumerate(ex.evaluation_criteria, 1)]
    items += [(f"D{i}", d.source) for i, d in enumerate(ex.disqualification_triggers, 1)]
    items += [(f"T{i}", d.source) for i, d in enumerate(ex.key_dates, 1)]
    return items


def verify_sources(ex: TenderExtraction, doc: TenderDocument) -> VerificationReport:
    items = _cited_items(ex)
    if not doc.has_text_layer:
        checks = [SourceCheck(item_id=i, status="unavailable") for i, _ in items]
        return VerificationReport(text_layer_available=False, checked=0, verified=0, checks=checks)
    checks = [
        SourceCheck(item_id=i, status=check_quote(s.quote, doc.page_texts, s.page))  # type: ignore[arg-type]
        for i, s in items
    ]
    verified = sum(1 for c in checks if c.status in ("exact", "fuzzy"))
    return VerificationReport(
        text_layer_available=True, checked=len(checks), verified=verified, checks=checks
    )
