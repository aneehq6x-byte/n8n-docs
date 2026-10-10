import type { Job } from "bullmq";
import type { ScoutIngestedEvent } from "@tenderpilot/core";
import { getDb, listActiveOrgIds, rescoreOrg, runScoutForOrg } from "@tenderpilot/db";
import { buildConnectors, scoutSince } from "./connectors";
import { scoringJobOrgId, scoringJobSchema, scoutJobSchema } from "./payloads";
import { enqueueScoring, enqueueScoutForOrg } from "./queues";

/** Ingest one org and publish the typed event downstream to scoring. */
export async function scoutOrg(orgId: string, actorUserId: string | null): Promise<ScoutIngestedEvent> {
  const event = await runScoutForOrg(getDb(), orgId, {
    connectors: buildConnectors(),
    since: scoutSince(),
    actorUserId,
  });
  await enqueueScoring({ kind: "scout.ingested", event });
  return event;
}

/** BullMQ processor for the `scout` queue. Payloads are re-validated — Redis is a boundary. */
export async function processScoutJob(job: Job<unknown>) {
  const data = scoutJobSchema.parse(job.data);
  if (data.kind === "sweep") {
    // Only orgs with a live trial/subscription are swept on schedule.
    const orgIds = await listActiveOrgIds(getDb());
    await Promise.all(orgIds.map((id) => enqueueScoutForOrg(id, null)));
    return { fannedOut: orgIds.length };
  }
  const event = await scoutOrg(data.orgId, data.actorUserId);
  return { created: event.createdTenderIds.length, updated: event.updatedTenderIds.length, failures: event.failures };
}

/** BullMQ processor for the `scoring` queue: tender ingest / profile change → refresh opportunities. */
export async function processScoringJob(job: Job<unknown>) {
  const data = scoringJobSchema.parse(job.data);
  return rescoreOrg(getDb(), scoringJobOrgId(data), {
    reason: data.kind,
    actorUserId: data.kind === "scout.ingested" ? null : data.actorUserId,
  });
}
