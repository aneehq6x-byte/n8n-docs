import type { Certification, CompanyProfile, Opportunity, Tender } from "../domain/models";
import { scoreOpportunity } from "../scoring/engine";
import { MockEtimadConnector } from "../scout/mock-etimad";
import { collectTenders, deterministicUuid, normalizeTender } from "../scout/scout";
import { DEMO_ORG_ID, demoCertifications, demoCompanyProfile } from "./fixtures";

/** Score one profile against a set of tenders (in-memory; the DB path mirrors this). */
export function buildOpportunities(
  tenders: readonly Tender[],
  profile: CompanyProfile,
  certifications: readonly Certification[],
  asOf: Date,
): Opportunity[] {
  return tenders.map((tender) => {
    const breakdown = scoreOpportunity({ tender, profile, certifications, asOf });
    return {
      id: deterministicUuid(`opp:${tender.id}:${profile.id}`),
      orgId: tender.orgId,
      tenderId: tender.id,
      companyProfileId: profile.id,
      score: breakdown.score,
      scoreBreakdown: breakdown,
      status: "new",
      assignedUserIds: [],
      createdAt: asOf,
      updatedAt: asOf,
    } satisfies Opportunity;
  });
}

export interface DemoGraph {
  profile: CompanyProfile;
  certifications: Certification[];
  tenders: Tender[];
  opportunities: Opportunity[];
}

/**
 * The full Phase-1 path with zero infrastructure: Scout (mock Etimad) →
 * normalize → score. Used by the CLI demo and the acceptance tests.
 */
export async function buildDemoGraph(asOf: Date): Promise<DemoGraph> {
  const { tenders: raws } = await collectTenders([new MockEtimadConnector({ clock: () => asOf })], new Date(0));
  const tenders = raws.map((raw) =>
    normalizeTender(raw, {
      id: deterministicUuid(`${DEMO_ORG_ID}:${raw.source}:${raw.sourceRef}`),
      orgId: DEMO_ORG_ID,
      entityId: deterministicUuid(`${DEMO_ORG_ID}:entity:${raw.entity.nameEn}`),
      asOf,
    }),
  );
  const profile = demoCompanyProfile();
  const certifications = demoCertifications(asOf);
  return { profile, certifications, tenders, opportunities: buildOpportunities(tenders, profile, certifications, asOf) };
}
