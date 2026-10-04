import { createHash } from "node:crypto";
import { z } from "zod";
import type { TenderStatus } from "../domain/enums";
import { tenderSchema, type Tender } from "../domain/models";
import type { RawTender } from "../domain/raw-tender";
import type { TenderConnector } from "./connector";

/** Stable key used to dedupe a tender across sources and runs. */
export function dedupeKey(source: string, sourceRef: string): string {
  return `${source}::${sourceRef}`;
}

/**
 * Deterministic RFC-4122 v5 UUID from a name — used for in-memory pipelines
 * (demo, tests) where no database assigns ids.
 */
export function deterministicUuid(name: string): string {
  const NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"; // RFC-4122 DNS namespace
  const hash = createHash("sha1");
  hash.update(Buffer.from(NAMESPACE.replace(/-/g, ""), "hex"));
  hash.update(name);
  const bytes = hash.digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50; // version 5
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Presentational status derived from the deadline relative to `asOf`. */
export function deriveStatus(submissionDeadline: Date, asOf: Date): TenderStatus {
  const daysLeft = (submissionDeadline.getTime() - asOf.getTime()) / (1000 * 60 * 60 * 24);
  if (daysLeft <= 0) return "closed";
  if (daysLeft <= 7) return "closing_soon";
  return "open";
}

export interface NormalizeContext {
  id: string;
  orgId: string;
  entityId: string;
  asOf: Date;
}

/** Turn a validated RawTender into a fully-typed, org-scoped Tender. */
export function normalizeTender(raw: RawTender, ctx: NormalizeContext): Tender {
  const submissionDeadline = new Date(raw.submissionDeadline);
  return tenderSchema.parse({
    id: ctx.id,
    orgId: ctx.orgId,
    sourceRef: raw.sourceRef,
    source: raw.source,
    entityId: ctx.entityId,
    title: { ar: raw.titleAr, en: raw.titleEn },
    description: { ar: raw.descriptionAr, en: raw.descriptionEn },
    sector: raw.sector,
    valueEstimate: raw.valueEstimate,
    currency: "SAR",
    requiredClassificationField: raw.requiredClassificationField,
    requiredClassificationGrade: raw.requiredClassificationGrade,
    requiredCertifications: raw.requiredCertifications,
    guarantee: { bidBondPct: raw.bidBondPct, performanceBondPct: raw.performanceBondPct },
    publishedAt: new Date(raw.publishedAt),
    submissionDeadline,
    status: deriveStatus(submissionDeadline, ctx.asOf),
    rawDocumentRefs: raw.rawDocumentRefs,
  });
}

export interface ConnectorFailure {
  source: string;
  message: string;
}

export interface CollectResult {
  /** Validated, batch-deduplicated raw tenders across all connectors. */
  tenders: RawTender[];
  fetchedPerSource: Record<string, number>;
  failures: ConnectorFailure[];
}

/**
 * Pull from every connector and dedupe by (source, sourceRef). One failing
 * connector is recorded and skipped — it never blocks the other sources.
 */
export async function collectTenders(connectors: readonly TenderConnector[], since: Date): Promise<CollectResult> {
  const seen = new Set<string>();
  const tenders: RawTender[] = [];
  const fetchedPerSource: Record<string, number> = {};
  const failures: ConnectorFailure[] = [];

  const results = await Promise.allSettled(connectors.map((c) => c.fetchTenders(since)));
  results.forEach((result, i) => {
    const source = connectors[i]?.source ?? `connector-${i}`;
    if (result.status === "rejected") {
      failures.push({ source, message: result.reason instanceof Error ? result.reason.message : String(result.reason) });
      return;
    }
    fetchedPerSource[source] = result.value.length;
    for (const raw of result.value) {
      const key = dedupeKey(raw.source, raw.sourceRef);
      if (seen.has(key)) continue;
      seen.add(key);
      tenders.push(raw);
    }
  });

  return { tenders, fetchedPerSource, failures };
}

/** Typed event emitted after every Scout ingestion. Consumers (scoring) subscribe via the job queue. */
export const scoutIngestedEventSchema = z.object({
  type: z.literal("scout.tenders.ingested"),
  orgId: z.uuid(),
  sources: z.array(z.string()),
  at: z.iso.datetime(),
  createdTenderIds: z.array(z.uuid()),
  updatedTenderIds: z.array(z.uuid()),
  failures: z.array(z.object({ source: z.string(), message: z.string() })),
});
export type ScoutIngestedEvent = z.infer<typeof scoutIngestedEventSchema>;
