"""Executive report (Arabic Markdown), rendered deterministically from the analysis."""

from __future__ import annotations

from .models import AnalysisResult, SourceRef
from .scoring import CATEGORY_LABELS

RECOMMENDATION = {"go": "✅ تقدّم (Go)", "review": "⚠️ مراجعة قبل القرار", "no_go": "⛔ لا تتقدّم (No-Go)"}
CONFIDENCE = {"high": "عالية", "medium": "متوسطة", "low": "منخفضة"}
LEVEL = {"low": "منخفض", "medium": "متوسط", "high": "مرتفع"}
LEVEL_RANK = {"low": 1, "medium": 2, "high": 3}
STATUS = {"met": "مستوفى", "partial": "جزئي", "unmet": "غير مستوفى", "unknown": "غير معروف"}
GUARANTEE = {
    "bid_bond": "ضمان ابتدائي",
    "performance_bond": "ضمان نهائي",
    "advance_payment": "ضمان دفعة مقدمة",
    "other": "أخرى",
}


def _src(s: SourceRef) -> str:
    parts = []
    if s.page:
        parts.append(f"ص{s.page}")
    if s.clause:
        parts.append(f"بند {s.clause}")
    return "، ".join(parts) or "—"


def _cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def render_markdown(result: AnalysisResult) -> str:
    ex, out = result.extraction, []
    out += [f"# تقرير تحليل المنافسة: {ex.tender_title}", ""]
    out += [
        f"- **الجهة:** {ex.issuing_entity}",
        f"- **الرقم المرجعي:** {ex.tender_reference or '—'}",
        f"- **آخر موعد للتقديم:** {ex.submission_deadline or '—'}",
        f"- **القيمة التقديرية:** "
        + (f"{ex.estimated_value_sar:,.0f} ريال" if ex.estimated_value_sar else "غير مذكورة"),
        f"- **مدة العقد:** {ex.contract_duration or '—'}",
        "",
    ]

    if result.score:
        s = result.score
        out += ["## القرار", ""]
        out += [
            f"**{RECOMMENDATION[s.recommendation]}** — Opportunity Score: **{s.score}/100** "
            f"(الثقة: {CONFIDENCE[s.confidence]})",
            "",
            "| العامل | الأثر | التفصيل |",
            "|---|---|---|",
        ]
        out += [f"| {f.label} | {f.impact:+.1f} | {_cell(f.detail)} |" for f in s.factors]
        out.append("")
        if s.blocking_gaps:
            out += ["**فجوات قد تؤدي للاستبعاد:**", ""]
            out += [f"- {g}" for g in s.blocking_gaps]
            out.append("")

    out += ["## نطاق العمل", "", ex.scope_summary, ""]

    status = {a.requirement_id: a for a in result.fit.assessments} if result.fit else {}
    out += ["## المتطلبات", ""]
    head = "| # | الفئة | المتطلب | إلزامي | المصدر |"
    sep = "|---|---|---|---|---|"
    if status:
        head, sep = head + " الحالة | الإجراء المقترح |", sep + "---|---|"
    out += [head, sep]
    for r in ex.requirements:
        row = f"| {r.id} | {CATEGORY_LABELS[r.category]} | {_cell(r.text)} | {'نعم' if r.mandatory else 'لا'} | {_src(r.source)} |"
        if status:
            a = status.get(r.id)
            row += f" {STATUS[a.status] if a else '—'} | {_cell(a.gap_action or '') if a else ''} |"
        out.append(row)
    out.append("")

    if ex.guarantees:
        out += ["## الضمانات", "", "| النوع | النسبة | الوصف | المصدر |", "|---|---|---|---|"]
        out += [
            f"| {GUARANTEE[g.type]} | {f'{g.percentage:g}%' if g.percentage is not None else '—'} "
            f"| {_cell(g.description)} | {_src(g.source)} |"
            for g in ex.guarantees
        ]
        out.append("")

    if ex.evaluation_criteria:
        out += ["## معايير التقييم", "", "| المعيار | الوزن | المصدر |", "|---|---|---|"]
        out += [
            f"| {_cell(c.criterion)} | {f'{c.weight_percent:g}%' if c.weight_percent is not None else '—'} "
            f"| {_src(c.source)} |"
            for c in ex.evaluation_criteria
        ]
        out.append("")

    if ex.risks:
        risks = sorted(ex.risks, key=lambda k: -LEVEL_RANK[k.likelihood] * LEVEL_RANK[k.impact])
        out += ["## مصفوفة المخاطر", "", "| # | الخطر | الاحتمال | الأثر | التخفيف | المصدر |"]
        out += ["|---|---|---|---|---|---|"]
        out += [
            f"| {k.id} | **{_cell(k.title)}** — {_cell(k.description)} | {LEVEL[k.likelihood]} "
            f"| {LEVEL[k.impact]} | {_cell(k.mitigation)} | {_src(k.source)} |"
            for k in risks
        ]
        out.append("")

    if ex.disqualification_triggers:
        out += ["## مسببات الاستبعاد الشكلي (قائمة تحقق)", ""]
        out += [f"- [ ] {d.description} ({_src(d.source)})" for d in ex.disqualification_triggers]
        out.append("")

    if ex.key_dates:
        out += ["## التواريخ المهمة", ""]
        out += [f"- **{d.label}:** {d.date_text}" for d in ex.key_dates]
        out.append("")

    if ex.clarification_questions:
        out += ["## أسئلة استيضاح مقترحة للجهة", ""]
        out += [f"{i}. {q}" for i, q in enumerate(ex.clarification_questions, 1)]
        out.append("")

    v = result.verification
    out += ["## موثوقية المصادر", ""]
    if v.text_layer_available:
        out.append(f"تم التحقق آلياً من {v.verified} من أصل {v.checked} اقتباس مقابل نص الكراسة.")
        missing = [c.item_id for c in v.checks if c.status == "not_found"]
        if missing:
            out.append(f"بنود تحتاج مراجعة يدوية للمصدر: {', '.join(missing)}")
    else:
        out.append("الملف ممسوح ضوئياً (بلا طبقة نصية)؛ راجع المصادر يدوياً.")
    out += [
        "",
        "---",
        "_هذا التقرير مُولَّد بالذكاء الاصطناعي لدعم القرار، ولا يغني عن مراجعة الكراسة الأصلية._",
    ]
    return "\n".join(out) + "\n"
