"""Command line.

    tenderpilot-analyze tender.pdf --profile company.json -o report.md --json analysis.json
    tenderpilot-write analysis.json --profile company.json -o proposal.docx
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from .analyzer import TenderAnalyzer
from .docx_export import build_docx, review_notes
from .models import AnalysisResult, CompanyProfile
from .report import render_markdown
from .writer import BidWriter


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Analyze a government tender document.")
    p.add_argument("pdf", type=Path, help="Tender document (PDF)")
    p.add_argument("--profile", type=Path, help="Company profile JSON (enables the Opportunity Score)")
    p.add_argument("-o", "--output", type=Path, help="Write the Markdown report here (default: stdout)")
    p.add_argument("--json", type=Path, help="Also write the full analysis as JSON")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING)
    profile = (
        CompanyProfile.model_validate_json(args.profile.read_text(encoding="utf-8"))
        if args.profile
        else None
    )
    result = TenderAnalyzer().analyze(args.pdf.read_bytes(), profile)

    report = render_markdown(result)
    if args.output:
        args.output.write_text(report, encoding="utf-8")
    else:
        sys.stdout.write(report)
    if args.json:
        args.json.write_text(result.model_dump_json(indent=2), encoding="utf-8")

    _print_usage(result.usage)
    return 0


def write_main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Draft a technical proposal from a tender analysis.")
    p.add_argument("analysis", type=Path, help="Analysis JSON from tenderpilot-analyze --json")
    p.add_argument("--profile", type=Path, required=True, help="Company profile JSON")
    p.add_argument("--notes", type=Path, help="Bid team guidance (text file)")
    p.add_argument("-o", "--output", type=Path, default=Path("technical-proposal.docx"))
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING)
    analysis = AnalysisResult.model_validate_json(args.analysis.read_text(encoding="utf-8"))
    profile = CompanyProfile.model_validate_json(args.profile.read_text(encoding="utf-8"))
    notes = args.notes.read_text(encoding="utf-8") if args.notes else None

    proposal = BidWriter().write(analysis, profile, notes)
    args.output.write_bytes(build_docx(proposal, analysis.extraction.risks))
    review = args.output.with_suffix(".review.md")
    review.write_text(review_notes(proposal), encoding="utf-8")
    args.output.with_suffix(".json").write_text(proposal.model_dump_json(indent=2), encoding="utf-8")

    print(
        f"{args.output}: {len(proposal.placeholders)} placeholders, "
        f"{len(proposal.uncovered_mandatory)} uncovered mandatory requirements — see {review}",
        file=sys.stderr,
    )
    _print_usage(proposal.usage)
    return 0


def _print_usage(usage) -> None:
    line = ", ".join(
        f"{u.task}: in={u.input_tokens} cached={u.cache_read_input_tokens} out={u.output_tokens}"
        for u in usage
    )
    print(f"[tokens] {line}", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
