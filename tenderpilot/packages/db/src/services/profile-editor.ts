import { and, eq, notInArray } from "drizzle-orm";
import { companyProfileFormSchema, type CompanyProfileForm, type RescoreImpact } from "@tenderpilot/core";
import { writeAudit } from "../audit";
import type { Database } from "../client";
import { certifications, opportunities } from "../schema";
import { getCompanyProfile, upsertCertifications, upsertCompanyProfile } from "./company-profile";
import { rescoreOrg } from "./scoring";

const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);
/** Dates from the form are calendar days; anchor them at UTC midnight. */
const fromIsoDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** Current profile in the editor's shape (null when the org has no profile yet). */
export async function getCompanyProfileForm(db: Database, orgId: string): Promise<CompanyProfileForm | null> {
  const bundle = await getCompanyProfile(db, orgId);
  if (!bundle) return null;
  const { profile } = bundle;
  return {
    legalNameAr: profile.legalName.ar,
    legalNameEn: profile.legalName.en,
    sectors: profile.sectors,
    annualTurnover: profile.annualTurnover,
    maxContractValue: profile.maxContractValue,
    classifications: profile.classifications,
    certifications: bundle.certifications
      .map((c) => ({
        type: c.type,
        issuer: c.issuer,
        issuedAt: toIsoDate(c.issuedAt),
        expiresAt: c.expiresAt ? toIsoDate(c.expiresAt) : null,
      }))
      .sort((a, b) => a.type.localeCompare(b.type)),
    pastProjects: profile.pastProjects.map((p) => ({
      titleAr: p.title.ar,
      titleEn: p.title.en,
      sector: p.sector,
      value: p.value,
      performancePct: Math.round(p.performanceRating * 100),
      year: p.year,
    })),
  };
}

type Snapshot = Map<string, { score: number; disqualified: boolean }>;

async function snapshot(db: Database, orgId: string): Promise<Snapshot> {
  const rows = await db
    .select({ id: opportunities.id, score: opportunities.score, disqualified: opportunities.disqualified })
    .from(opportunities)
    .where(eq(opportunities.orgId, orgId));
  return new Map(rows.map((r) => [r.id, { score: r.score, disqualified: r.disqualified }]));
}

function average(values: number[]): number | null {
  return values.length === 0 ? null : Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
}

export function computeImpact(before: Snapshot, after: Snapshot): RescoreImpact {
  let improved = 0;
  let declined = 0;
  let newlyEligible = 0;
  let newlyDisqualified = 0;
  for (const [id, now] of after) {
    const prev = before.get(id);
    if (!prev) continue;
    if (now.score > prev.score + 0.05) improved++;
    else if (now.score < prev.score - 0.05) declined++;
    if (prev.disqualified && !now.disqualified) newlyEligible++;
    if (!prev.disqualified && now.disqualified) newlyDisqualified++;
  }
  return {
    scored: after.size,
    improved,
    declined,
    newlyEligible,
    newlyDisqualified,
    averageBefore: average([...before.values()].map((v) => v.score)),
    averageAfter: average([...after.values()].map((v) => v.score)),
  };
}

/**
 * Save the whole bidding profile (incl. certifications) atomically, audit it,
 * then re-score every opportunity and report how the change moved them.
 * Re-scoring runs inline: it is a pure function over the org's tenders, so the
 * user sees the effect of their edit immediately.
 */
export async function saveCompanyProfile(
  db: Database,
  orgId: string,
  input: unknown,
  actorUserId: string,
): Promise<RescoreImpact> {
  const form = companyProfileFormSchema.parse(input);
  const before = await snapshot(db, orgId);

  await db.transaction(async (tx) => {
    const profile = await upsertCompanyProfile(tx, orgId, {
      legalNameAr: form.legalNameAr,
      legalNameEn: form.legalNameEn,
      sectors: form.sectors,
      classifications: form.classifications,
      annualTurnover: form.annualTurnover,
      maxContractValue: form.maxContractValue,
      pastProjects: form.pastProjects.map((p) => ({
        title: { ar: p.titleAr, en: p.titleEn },
        sector: p.sector,
        value: p.value,
        performanceRating: p.performancePct / 100,
        year: p.year,
      })),
    });

    // Replace the certification set: drop types no longer held, upsert the rest.
    const keep = form.certifications.map((c) => c.type);
    await tx
      .delete(certifications)
      .where(
        keep.length > 0
          ? and(eq(certifications.companyProfileId, profile.id), notInArray(certifications.type, keep))
          : eq(certifications.companyProfileId, profile.id),
      );
    await upsertCertifications(
      tx,
      orgId,
      profile.id,
      form.certifications.map((c) => ({
        type: c.type,
        issuer: c.issuer,
        issuedAt: fromIsoDate(c.issuedAt),
        expiresAt: c.expiresAt ? fromIsoDate(c.expiresAt) : null,
      })),
    );

    await writeAudit(tx, {
      orgId,
      actorUserId,
      action: "company_profile.updated",
      targetType: "company_profile",
      targetId: profile.id,
      metadata: {
        sectors: form.sectors.length,
        classifications: form.classifications.length,
        certifications: form.certifications.length,
        pastProjects: form.pastProjects.length,
      },
    });
  });

  await rescoreOrg(db, orgId, { reason: "profile.changed", actorUserId });
  return computeImpact(before, await snapshot(db, orgId));
}
