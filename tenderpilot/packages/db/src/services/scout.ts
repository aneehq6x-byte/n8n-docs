import { asc, sql } from "drizzle-orm";
import {
  collectTenders,
  deriveStatus,
  scoutIngestedEventSchema,
  type RawTender,
  type ScoutIngestedEvent,
  type TenderConnector,
} from "@tenderpilot/core";
import { writeAudit } from "../audit";
import type { Database, DbExecutor } from "../client";
import { entities, orgs, tenders } from "../schema";

export interface PersistResult {
  createdTenderIds: string[];
  updatedTenderIds: string[];
}

/**
 * Upsert issuers and tenders for one org in a single transaction.
 * Idempotent: re-ingesting the same (source, source_ref) updates in place.
 * `xmax = 0` is Postgres' tell that a row was freshly inserted (not updated).
 */
export async function persistScoutBatch(
  db: DbExecutor,
  orgId: string,
  raws: readonly RawTender[],
  asOf: Date,
): Promise<PersistResult> {
  if (raws.length === 0) return { createdTenderIds: [], updatedTenderIds: [] };

  const uniqueEntities = [...new Map(raws.map((r) => [r.entity.nameEn, r.entity])).values()];
  const entityRows = await db
    .insert(entities)
    .values(
      uniqueEntities.map((e) => ({
        orgId,
        nameAr: e.nameAr,
        nameEn: e.nameEn,
        kind: e.kind,
        regionAr: e.regionAr,
        regionEn: e.regionEn,
      })),
    )
    .onConflictDoUpdate({
      target: [entities.orgId, entities.nameEn],
      set: {
        nameAr: sql`excluded.name_ar`,
        kind: sql`excluded.kind`,
        regionAr: sql`excluded.region_ar`,
        regionEn: sql`excluded.region_en`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: entities.id, nameEn: entities.nameEn });
  const entityIdByName = new Map(entityRows.map((e) => [e.nameEn, e.id]));

  const rows = await db
    .insert(tenders)
    .values(
      raws.map((r) => {
        const entityId = entityIdByName.get(r.entity.nameEn);
        if (!entityId) throw new Error(`entity not resolved for ${r.entity.nameEn}`);
        const submissionDeadline = new Date(r.submissionDeadline);
        return {
          orgId,
          source: r.source,
          sourceRef: r.sourceRef,
          entityId,
          titleAr: r.titleAr,
          titleEn: r.titleEn,
          descriptionAr: r.descriptionAr,
          descriptionEn: r.descriptionEn,
          sector: r.sector,
          valueEstimate: r.valueEstimate,
          requiredClassificationField: r.requiredClassificationField,
          requiredClassificationGrade: r.requiredClassificationGrade,
          requiredCertifications: r.requiredCertifications,
          guarantee: { bidBondPct: r.bidBondPct, performanceBondPct: r.performanceBondPct },
          publishedAt: new Date(r.publishedAt),
          submissionDeadline,
          status: deriveStatus(submissionDeadline, asOf),
          rawDocumentRefs: r.rawDocumentRefs,
        };
      }),
    )
    .onConflictDoUpdate({
      target: [tenders.orgId, tenders.source, tenders.sourceRef],
      set: {
        entityId: sql`excluded.entity_id`,
        titleAr: sql`excluded.title_ar`,
        titleEn: sql`excluded.title_en`,
        descriptionAr: sql`excluded.description_ar`,
        descriptionEn: sql`excluded.description_en`,
        sector: sql`excluded.sector`,
        valueEstimate: sql`excluded.value_estimate`,
        requiredClassificationField: sql`excluded.required_classification_field`,
        requiredClassificationGrade: sql`excluded.required_classification_grade`,
        requiredCertifications: sql`excluded.required_certifications`,
        guarantee: sql`excluded.guarantee`,
        publishedAt: sql`excluded.published_at`,
        submissionDeadline: sql`excluded.submission_deadline`,
        status: sql`excluded.status`,
        rawDocumentRefs: sql`excluded.raw_document_refs`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: tenders.id, inserted: sql<boolean>`(xmax = 0)` });

  return {
    createdTenderIds: rows.filter((r) => r.inserted).map((r) => r.id),
    updatedTenderIds: rows.filter((r) => !r.inserted).map((r) => r.id),
  };
}

export interface RunScoutOptions {
  connectors: readonly TenderConnector[];
  since: Date;
  asOf?: Date;
  /** Who triggered it (null for scheduled sweeps). */
  actorUserId?: string | null;
}

/**
 * Scout Agent for one org: pull from connectors → validate → dedupe →
 * upsert → audit → return the typed `scout.tenders.ingested` event.
 */
export async function runScoutForOrg(db: Database, orgId: string, opts: RunScoutOptions): Promise<ScoutIngestedEvent> {
  const asOf = opts.asOf ?? new Date();
  const collected = await collectTenders(opts.connectors, opts.since);

  const persisted = await db.transaction(async (tx) => {
    const result = await persistScoutBatch(tx, orgId, collected.tenders, asOf);
    await writeAudit(tx, {
      orgId,
      actorUserId: opts.actorUserId ?? null,
      action: "scout.completed",
      metadata: {
        fetchedPerSource: collected.fetchedPerSource,
        created: result.createdTenderIds.length,
        updated: result.updatedTenderIds.length,
        failures: collected.failures,
      },
    });
    return result;
  });

  return scoutIngestedEventSchema.parse({
    type: "scout.tenders.ingested",
    orgId,
    sources: opts.connectors.map((c) => c.source),
    at: asOf.toISOString(),
    createdTenderIds: persisted.createdTenderIds,
    updatedTenderIds: persisted.updatedTenderIds,
    failures: collected.failures,
  });
}

/** All org ids, for the scheduled sweep. */
export async function listOrgIds(db: DbExecutor): Promise<string[]> {
  const rows = await db.select({ id: orgs.id }).from(orgs).orderBy(asc(orgs.createdAt));
  return rows.map((r) => r.id);
}
