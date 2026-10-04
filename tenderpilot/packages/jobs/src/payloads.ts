import { z } from "zod";
import { scoutIngestedEventSchema } from "@tenderpilot/core";

export const SCOUT_QUEUE = "scout";
export const SCORING_QUEUE = "scoring";

/** Scout queue jobs. */
export const scoutJobSchema = z.discriminatedUnion("kind", [
  /** Scheduled fan-out: enqueue one `org` job per tenant. */
  z.object({ kind: z.literal("sweep") }),
  /** Ingest for one org (scheduled fan-out or on-demand "Run Scout now"). */
  z.object({ kind: z.literal("org"), orgId: z.uuid(), actorUserId: z.uuid().nullable() }),
]);
export type ScoutJob = z.infer<typeof scoutJobSchema>;

/** Scoring queue jobs — every reason to (re)compute an org's opportunities. */
export const scoringJobSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("scout.ingested"), event: scoutIngestedEventSchema }),
  z.object({ kind: z.literal("profile.changed"), orgId: z.uuid(), actorUserId: z.uuid().nullable() }),
  z.object({ kind: z.literal("manual"), orgId: z.uuid(), actorUserId: z.uuid().nullable() }),
]);
export type ScoringJob = z.infer<typeof scoringJobSchema>;

export function scoringJobOrgId(job: ScoringJob): string {
  return job.kind === "scout.ingested" ? job.event.orgId : job.orgId;
}
