/**
 * Zero-infrastructure demo of the Phase-1 pipeline:
 *   mock Etimad → normalize → explainable scoring → ranked, bilingual board.
 *
 *   pnpm --filter @tenderpilot/core demo [--lang ar]
 */
import { parseArgs } from "node:util";
import { buildDemoGraph, SECTOR_LABELS } from "../src";

const { values } = parseArgs({ options: { lang: { type: "string", default: "en" } } });
const ar = values.lang === "ar";

const bar = (ratio: number) => "█".repeat(Math.round(ratio * 10)).padEnd(10, "░");

const graph = await buildDemoGraph(new Date());
console.log(`\n🏢  ${ar ? graph.profile.legalName.ar : graph.profile.legalName.en}\n`);

const ranked = [...graph.opportunities].sort((a, b) =>
  a.scoreBreakdown.disqualified === b.scoreBreakdown.disqualified ? b.score - a.score : a.scoreBreakdown.disqualified ? 1 : -1,
);

for (const opp of ranked) {
  const tender = graph.tenders.find((t) => t.id === opp.tenderId);
  if (!tender) continue;
  const b = opp.scoreBreakdown;
  console.log("─".repeat(78));
  console.log(`[${opp.score.toFixed(1).padStart(5)}]  ${ar ? tender.title.ar : tender.title.en}${b.disqualified ? "  ⛔" : ""}`);
  console.log(
    `         ${ar ? SECTOR_LABELS[tender.sector].ar : SECTOR_LABELS[tender.sector].en} · ` +
      `${(tender.valueEstimate ?? 0).toLocaleString("en-US")} SAR · ${tender.submissionDeadline.toISOString().slice(0, 10)}`,
  );
  if (b.disqualified) console.log(`         ⛔ ${ar ? b.disqualificationReasonAr : b.disqualificationReasonEn}`);
  for (const f of b.factors) {
    console.log(`           ${bar(f.ratio)}  ${(ar ? f.labelAr : f.labelEn).padEnd(28)} +${f.contribution.toFixed(1).padStart(4)}  ${ar ? f.reasonAr : f.reasonEn}`);
  }
}
console.log("─".repeat(78) + "\n");
