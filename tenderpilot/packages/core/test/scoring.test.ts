import { describe, expect, it } from "vitest";
import {
  FACTORS,
  FACTOR_KEYS,
  buildDemoGraph,
  dayOffset,
  demoCertifications,
  demoCompanyProfile,
  scoreBand,
  scoreOpportunity,
  type CompanyProfile,
  type ScoreBreakdown,
  type ScoringInput,
  type Tender,
} from "../src";

const AS_OF = new Date("2026-06-26T00:00:00.000Z");
const profile = demoCompanyProfile();
const certifications = demoCertifications(AS_OF);

async function tenderByRef(ref: string): Promise<Tender> {
  const { tenders } = await buildDemoGraph(AS_OF);
  const tender = tenders.find((t) => t.sourceRef === ref);
  if (!tender) throw new Error(`fixture ${ref} not found`);
  return tender;
}

function score(overrides: Partial<ScoringInput> & { tender: Tender }): ScoreBreakdown {
  return scoreOpportunity({ profile, certifications, asOf: AS_OF, ...overrides });
}

function factor(b: ScoreBreakdown, key: keyof typeof FACTORS) {
  const f = b.factors.find((x) => x.key === key);
  if (!f) throw new Error(`factor ${key} missing`);
  return f;
}

describe("scoreOpportunity — reference cases", () => {
  it("scores a fully eligible, well-matched tender near the top", async () => {
    const b = score({ tender: await tenderByRef("250439001503") }); // Riyadh healthcare centre
    expect(b.disqualified).toBe(false);
    // sector 25 + classification 20 + certs 20 + value 15 + deadline 10 + past perf 9.2
    expect(b.score).toBe(99.2);
  });

  it("disqualifies when the classification grade is too weak, but keeps the breakdown", async () => {
    const b = score({ tender: await tenderByRef("250551002388") }); // interchange: roads grade 1, we hold grade 2
    expect(b.disqualified).toBe(true);
    expect(b.disqualificationReasonEn).toMatch(/grade below/i);
    expect(b.disqualificationReasonAr).toBeTruthy();
    expect(factor(b, "classification_eligibility").ratio).toBe(0);
    expect(factor(b, "value_fit").ratio).toBe(0); // 320M vs 60M ceiling: ≥ 2× → 0
    expect(b.score).toBe(63.4);
  });

  it("penalises sector mismatch, missing classification and missing certifications together", async () => {
    const b = score({ tender: await tenderByRef("250512774120") }); // IT platform
    expect(factor(b, "sector_match").ratio).toBe(0);
    expect(factor(b, "certification_coverage").ratio).toBeCloseTo(1 / 3, 5);
    expect(b.disqualified).toBe(true);
    expect(b.disqualificationReasonEn).toMatch(/no .* classification/i);
    expect(b.score).toBe(24.9);
  });
});

describe("scoreOpportunity — edge cases", () => {
  it("gives zero certification coverage when the company holds no certifications", async () => {
    const b = score({ tender: await tenderByRef("250439001503"), certifications: [] });
    expect(factor(b, "certification_coverage").ratio).toBe(0);
    expect(factor(b, "certification_coverage").reasonEn).toMatch(/Missing 3 of 3/);
    expect(b.disqualified).toBe(false); // missing certs lower the score but are not a hard gate
  });

  it("excludes certifications that expire before the submission deadline", async () => {
    const base = await tenderByRef("250439001503"); // requires Nitaqat, which expires at +188d
    const b = score({ tender: { ...base, submissionDeadline: dayOffset(AS_OF, 198) } });
    expect(factor(b, "certification_coverage").ratio).toBeCloseTo(2 / 3, 5);
    expect(factor(b, "certification_coverage").reasonEn).toMatch(/Nitaqat/);
  });

  it("counts non-expiring certifications as valid", async () => {
    const base = await tenderByRef("250439001503");
    const forever = certifications.map((c) => ({ ...c, expiresAt: null }));
    const b = score({ tender: { ...base, submissionDeadline: dayOffset(AS_OF, 5000) }, certifications: forever });
    expect(factor(b, "certification_coverage").ratio).toBe(1);
  });

  it("treats a tender with no required certifications as fully covered", async () => {
    const base = await tenderByRef("250439001503");
    const b = score({ tender: { ...base, requiredCertifications: [] }, certifications: [] });
    expect(factor(b, "certification_coverage").ratio).toBe(1);
  });

  it("does not gate when no classification is required", async () => {
    const b = score({ tender: await tenderByRef("250467119884") }); // Ministry of Education supply
    expect(factor(b, "classification_eligibility").ratio).toBe(1);
  });

  it("gates when the company has no classifications at all", async () => {
    const bare: CompanyProfile = { ...profile, classifications: [] };
    const b = score({ tender: await tenderByRef("250439001503"), profile: bare });
    expect(b.disqualified).toBe(true);
  });

  it("uses a neutral value-fit when the value is undisclosed", async () => {
    const base = await tenderByRef("250439001503");
    const b = score({ tender: { ...base, valueEstimate: null } });
    expect(factor(b, "value_fit").ratio).toBe(0.6);
  });

  it("decays value fit linearly above the capacity ceiling", async () => {
    const base = await tenderByRef("250439001503");
    const at = (v: number) => factor(score({ tender: { ...base, valueEstimate: v } }), "value_fit").ratio;
    expect(at(60_000_000)).toBe(1);
    expect(at(90_000_000)).toBeCloseTo(0.5, 5);
    expect(at(120_000_000)).toBe(0);
    expect(at(1_000_000)).toBeGreaterThanOrEqual(0.6); // tiny contracts stay acceptable
  });

  it("gives zero deadline feasibility once the deadline has passed", async () => {
    const base = await tenderByRef("250439001503");
    const b = score({ tender: { ...base, submissionDeadline: dayOffset(AS_OF, -1) } });
    expect(factor(b, "deadline_feasibility").ratio).toBe(0);
  });

  it("scales deadline feasibility for tight deadlines", async () => {
    const b = score({ tender: await tenderByRef("250645119963") }); // closes in 2 days
    const f = factor(b, "deadline_feasibility");
    expect(f.ratio).toBeGreaterThan(0);
    expect(f.ratio).toBeLessThan(0.15);
    expect(f.reasonEn).toMatch(/Only 2 days/);
  });

  it("uses a cautious baseline when there is no past performance in the sector", async () => {
    const b = score({ tender: await tenderByRef("250467119884") }); // education — no past projects
    expect(factor(b, "past_performance").ratio).toBe(0.3);
  });
});

describe("scoreOpportunity — invariants", () => {
  it("is deterministic", async () => {
    const tender = await tenderByRef("250498233017");
    expect(score({ tender })).toStrictEqual(score({ tender }));
  });

  it("returns every factor exactly once, in catalogue order, with bilingual reasons", async () => {
    const b = score({ tender: await tenderByRef("250498233017") });
    expect(b.factors.map((f) => f.key)).toEqual(FACTOR_KEYS);
    for (const f of b.factors) {
      expect(f.reasonAr).toMatch(/[؀-ۿ]/);
      expect(f.reasonEn).toMatch(/[A-Za-z]/);
    }
  });

  it("keeps scores within 0–100 and the score equal to the sum of contributions", async () => {
    const { tenders } = await buildDemoGraph(AS_OF);
    for (const tender of tenders) {
      const b = score({ tender });
      expect(b.score).toBeGreaterThanOrEqual(0);
      expect(b.score).toBeLessThanOrEqual(100);
      const sum = b.factors.reduce((s, f) => s + f.contribution, 0);
      expect(b.score).toBeCloseTo(sum, 6);
      for (const f of b.factors) expect(f.contribution).toBeLessThanOrEqual(f.weight * 100 + 1e-9);
    }
  });

  it("never lowers the score when the company gains a certification", async () => {
    const tender = await tenderByRef("250523660471"); // needs SFDA, which the company lacks
    const before = score({ tender });
    const sfda = { ...certifications[0]!, id: "aaaaaaa1-0000-4000-8000-000000000009", type: "sfda_license" as const };
    const after = score({ tender, certifications: [...certifications, sfda] });
    expect(after.score).toBeGreaterThan(before.score);
  });

  it("maps scores to bands", () => {
    expect(scoreBand(99.2)).toBe("high");
    expect(scoreBand(63.4)).toBe("medium");
    expect(scoreBand(24.9)).toBe("low");
  });
});
