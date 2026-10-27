"""Extraction accuracy against human-reviewed gold briefs.

Layout of an eval directory — one gold file per tender:

    evals/
      riyadh-om-114.pdf
      riyadh-om-114.gold.json   {"requirements": [{"text": "...", "mandatory": true}, ...],
                                 "disqualification_triggers": ["...", ...]}

Each gold requirement is matched to the closest extracted one by word overlap
after Arabic normalization and light stemming. Word overlap undercounts heavy
paraphrases, so every miss is listed for a person to confirm: the score is a
floor, and the list of misses is what tells you what the model actually lost.

Analyses are cached next to the PDFs (``<name>.analysis.json``), so re-scoring
after editing a gold file costs nothing; delete the cache to re-run the model.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field
from pathlib import Path

from pydantic import BaseModel

from .analyzer import TenderAnalyzer
from .models import AnalysisResult
from .verify import normalize

MATCH_THRESHOLD = 0.5

_PREFIXES = ("وبال", "وال", "بال", "كال", "فال", "لل", "ال", "و")
_SUFFIXES = ("ات", "ين", "ون", "ها", "هم", "ه")
_STOPWORDS = {
    "في", "من", "علي", "الي", "عن", "ان", "او", "مع", "ما", "لا", "هذا", "هذه", "ذلك", "التي", "الذي",
    "كل", "اي", "بعد", "قبل", "عند", "يجب", "يشترط", "لم", "قد", "به", "بها", "له", "لها",
}


class GoldRequirement(BaseModel):
    text: str
    mandatory: bool = False


class GoldBrief(BaseModel):
    requirements: list[GoldRequirement]
    disqualification_triggers: list[str] = []


def _stem(word: str) -> str:
    for p in _PREFIXES:
        if word.startswith(p) and len(word) - len(p) >= 3:
            word = word[len(p):]
            break
    for s in _SUFFIXES:
        if word.endswith(s) and len(word) - len(s) >= 3:
            word = word[: -len(s)]
            break
    return word


def terms(text: str) -> set[str]:
    return {_stem(w) for w in normalize(text).split() if w not in _STOPWORDS and len(w) > 1}


def similarity(gold: str, candidate: str) -> float:
    """Share of the gold item's terms the candidate covers."""
    g = terms(gold)
    return len(g & terms(candidate)) / len(g) if g else 0.0


def best_match(gold: str, candidates: list[str]) -> tuple[int | None, float]:
    scored = [(i, similarity(gold, c)) for i, c in enumerate(candidates)]
    i, s = max(scored, key=lambda x: x[1], default=(None, 0.0))
    return (i, s) if s >= MATCH_THRESHOLD else (None, s)


@dataclass
class TenderScore:
    name: str
    gold_total: int = 0
    gold_mandatory: int = 0
    found: int = 0
    found_mandatory: int = 0
    mandatory_flag_correct: int = 0
    triggers_total: int = 0
    triggers_found: int = 0
    extracted: int = 0
    quotes_verified: float | None = None
    misses: list[str] = field(default_factory=list)


def score_tender(name: str, gold: GoldBrief, result: AnalysisResult) -> TenderScore:
    ex = result.extraction
    texts = [f"{r.text} {r.source.quote}" for r in ex.requirements]
    s = TenderScore(name=name, extracted=len(ex.requirements), quotes_verified=result.verification.ratio)
    for g in gold.requirements:
        s.gold_total += 1
        s.gold_mandatory += g.mandatory
        idx, _ = best_match(g.text, texts)
        if idx is None:
            s.misses.append(("[إلزامي] " if g.mandatory else "") + g.text)
            continue
        s.found += 1
        s.found_mandatory += g.mandatory
        s.mandatory_flag_correct += ex.requirements[idx].mandatory == g.mandatory
    triggers = [f"{d.description} {d.source.quote}" for d in ex.disqualification_triggers]
    for t in gold.disqualification_triggers:
        s.triggers_total += 1
        if best_match(t, triggers)[0] is not None:
            s.triggers_found += 1
        else:
            s.misses.append("[سبب استبعاد] " + t)
    return s


def _pct(n: int, d: int) -> str:
    return f"{n / d:.0%}" if d else "—"


def render(scores: list[TenderScore], target: float) -> tuple[str, bool]:
    tot = lambda attr: sum(getattr(s, attr) for s in scores)  # noqa: E731
    mand_recall = tot("found_mandatory") / tot("gold_mandatory") if tot("gold_mandatory") else 0.0
    passed = mand_recall >= target
    out = [
        "# تقييم دقة الاستخراج",
        "",
        f"**استخراج المتطلبات الإلزامية: {mand_recall:.0%}** (الهدف {target:.0%}) — "
        + ("✅ تحقق" if passed else "❌ لم يتحقق"),
        "",
        f"- كل المتطلبات: {_pct(tot('found'), tot('gold_total'))} ({tot('found')}/{tot('gold_total')})",
        f"- دقة تصنيف الإلزامي في المتطلبات المطابقة: {_pct(tot('mandatory_flag_correct'), tot('found'))}",
        f"- أسباب الاستبعاد الشكلي: {_pct(tot('triggers_found'), tot('triggers_total'))}",
        "",
        "النسب حدّ أدنى: المطابقة بالكلمات قد لا تتعرّف على صياغة مختلفة لنفس المتطلب. راجع قائمة "
        "المفقودات أدناه — ما وجدته في التحليل فعلاً ليس خطأ في النموذج.",
        "",
        "| الكراسة | الإلزامية | الكل | أسباب الاستبعاد | مستخرج | اقتباسات موثّقة |",
        "|---|---|---|---|---|---|",
    ]
    for s in scores:
        q = f"{s.quotes_verified:.0%}" if s.quotes_verified is not None else "—"
        out.append(
            f"| {s.name} | {_pct(s.found_mandatory, s.gold_mandatory)} | {_pct(s.found, s.gold_total)} "
            f"| {_pct(s.triggers_found, s.triggers_total)} | {s.extracted} | {q} |"
        )
    out.append("")
    for s in scores:
        if s.misses:
            out += [f"## مفقودات: {s.name}", ""] + [f"- [ ] {m}" for m in s.misses] + [""]
    return "\n".join(out) + "\n", passed


def run(directory: Path, analyzer: TenderAnalyzer | None, target: float) -> tuple[str, bool]:
    scores = []
    golds = sorted(directory.glob("*.gold.json"))
    if not golds:
        raise SystemExit(f"لا توجد ملفات *.gold.json في {directory}")
    for gold_path in golds:
        name = gold_path.name.removesuffix(".gold.json")
        gold = GoldBrief.model_validate_json(gold_path.read_text(encoding="utf-8"))
        cache = directory / f"{name}.analysis.json"
        if cache.exists():
            result = AnalysisResult.model_validate_json(cache.read_text(encoding="utf-8"))
        else:
            pdf = directory / f"{name}.pdf"
            if not pdf.exists():
                raise SystemExit(f"لا يوجد {pdf.name} مقابل {gold_path.name}")
            analyzer = analyzer or TenderAnalyzer()
            print(f"تحليل {pdf.name}…", file=sys.stderr)
            result = analyzer.analyze(pdf.read_bytes())
            cache.write_text(result.model_dump_json(indent=2), encoding="utf-8")
        scores.append(score_tender(name, gold, result))
    return render(scores, target)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Measure extraction accuracy against gold briefs.")
    p.add_argument("directory", type=Path)
    p.add_argument("--target", type=float, default=0.9, help="Mandatory-requirement recall target")
    p.add_argument("-o", "--output", type=Path, help="Write the Markdown report here")
    args = p.parse_args(argv)
    report, passed = run(args.directory, None, args.target)
    if args.output:
        args.output.write_text(report, encoding="utf-8")
    sys.stdout.write(report)
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())

