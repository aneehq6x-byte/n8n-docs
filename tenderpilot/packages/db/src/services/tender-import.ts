import { CsvImportConnector, type RawTender } from "@tenderpilot/core";
import { writeAudit } from "../audit";
import type { Database } from "../client";
import { rescoreOrg } from "./scoring";
import { runScoutForOrg } from "./scout";

/**
 * Ingest validated, imported tenders through the standard Scout pipeline
 * (same dedupe/upsert/audit/event path as connectors), then re-score.
 */
export async function importTenders(db: Database, orgId: string, tenders: readonly RawTender[], actorUserId: string) {
  const event = await runScoutForOrg(db, orgId, {
    connectors: [new CsvImportConnector(tenders)],
    since: new Date(0),
    actorUserId,
  });
  const scored = await rescoreOrg(db, orgId, { reason: "scout.ingested", actorUserId });
  await writeAudit(db, {
    orgId,
    actorUserId,
    action: "tenders.imported",
    metadata: { rows: tenders.length, created: event.createdTenderIds.length, updated: event.updatedTenderIds.length },
  });
  return { created: event.createdTenderIds.length, updated: event.updatedTenderIds.length, scored: scored.scored };
}
