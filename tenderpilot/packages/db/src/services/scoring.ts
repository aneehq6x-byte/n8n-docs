import { eq, sql } from "drizzle-orm";
import { scoreOpportunity } from "@tenderpilot/core";
import { writeAudit } from "../audit";
import type { Database } from "../client";
import { toTender } from "../mappers";
import { opportunities, tenders } from "../schema";
import { getCompanyProfile } from "./company-profile";

export interface RescoreResult {
  orgId: string;
  scored: number;
  disqualified: number;
  skippedReason: "no_profile" | null;
}

export interface RescoreOptions {
  asOf?: Date;
  actorUserId?: string | null;
  reason: "scout.ingested" | "profile.changed" | "manual" | "seed";
}

/**
 * Compute / refresh every opportunity for an org from its current bidding
 * profile. The whole org is re-scored (not just new tenders) because
 * deadline feasibility and certification validity are time-dependent and a
 * profile change affects every tender. Workflow fields (status, assignees)
 * are preserved on refresh.
 */
export async function rescoreOrg(db: Database, orgId: string, opts: RescoreOptions): Promise<RescoreResult> {
  const asOf = opts.asOf ?? new Date();
  const bundle = await getCompanyProfile(db, orgId);
  if (!bundle) return { orgId, scored: 0, disqualified: 0, skippedReason: "no_profile" };

  const tenderRows = await db.select().from(tenders).where(eq(tenders.orgId, orgId));
  const rows = tenderRows.map((row) => {
    const tender = toTender(row);
    const breakdown = scoreOpportunity({ tender, profile: bundle.profile, certifications: bundle.certifications, asOf });
    return {
      orgId,
      tenderId: tender.id,
      companyProfileId: bundle.profile.id,
      score: breakdown.score,
      scoreBreakdown: breakdown,
      disqualified: breakdown.disqualified,
      scoredAt: asOf,
    };
  });

  await db.transaction(async (tx) => {
    // Chunk to stay well inside Postgres' bind-parameter limit for large orgs.
    for (let i = 0; i < rows.length; i += 500) {
      await tx
        .insert(opportunities)
        .values(rows.slice(i, i + 500))
        .onConflictDoUpdate({
          target: [opportunities.tenderId, opportunities.companyProfileId],
          set: {
            score: sql`excluded.score`,
            scoreBreakdown: sql`excluded.score_breakdown`,
            disqualified: sql`excluded.disqualified`,
            scoredAt: sql`excluded.scored_at`,
            updatedAt: sql`now()`,
          },
        });
    }
    await writeAudit(tx, {
      orgId,
      actorUserId: opts.actorUserId ?? null,
      action: "opportunities.rescored",
      metadata: { reason: opts.reason, scored: rows.length, disqualified: rows.filter((r) => r.disqualified).length },
    });
  });

  return { orgId, scored: rows.length, disqualified: rows.filter((r) => r.disqualified).length, skippedReason: null };
}
