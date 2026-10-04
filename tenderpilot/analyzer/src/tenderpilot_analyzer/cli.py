"""Command line: ``tenderpilot-analyze tender.pdf --profile company.json -o report.md``."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from .analyzer import TenderAnalyzer
from .models import CompanyProfile
from .report import render_markdown


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

    usage = ", ".join(
        f"{u.task}: in={u.input_tokens} cached={u.cache_read_input_tokens} out={u.output_tokens}"
        for u in result.usage
    )
    print(f"[tokens] {usage}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
