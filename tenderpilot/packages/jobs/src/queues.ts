import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import { getServerEnv } from "@tenderpilot/config";
import { SCORING_QUEUE, SCOUT_QUEUE, type ScoringJob, type ScoutJob, scoringJobOrgId } from "./payloads";

/**
 * A fresh ioredis client. BullMQ 6 treats ioredis as an optional peer and, under
 * native ESM, expects a constructed client rather than connection options.
 * `maxRetriesPerRequest: null` is required for workers' blocking commands.
 */
export function createRedisClient(): Redis {
  return new Redis(getServerEnv().REDIS_URL, { maxRetriesPerRequest: null });
}

const globalForRedis = globalThis as typeof globalThis & { __tpRedis?: Redis };

/** Shared producer connection for queues (workers create their own via createRedisClient). */
export function redisConnection(): Redis {
  globalForRedis.__tpRedis ??= createRedisClient();
  return globalForRedis.__tpRedis;
}

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

const globalForQueues = globalThis as typeof globalThis & {
  __tpScoutQueue?: Queue<ScoutJob>;
  __tpScoringQueue?: Queue<ScoringJob>;
};

export function getScoutQueue(): Queue<ScoutJob> {
  globalForQueues.__tpScoutQueue ??= new Queue<ScoutJob>(SCOUT_QUEUE, {
    connection: redisConnection(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  return globalForQueues.__tpScoutQueue;
}

export function getScoringQueue(): Queue<ScoringJob> {
  globalForQueues.__tpScoringQueue ??= new Queue<ScoringJob>(SCORING_QUEUE, {
    connection: redisConnection(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  return globalForQueues.__tpScoringQueue;
}

/**
 * On-demand Scout for one org. Deduplicated per org: while a run for this org
 * is queued or active, further triggers are no-ops (protects the upstream portal).
 */
export async function enqueueScoutForOrg(orgId: string, actorUserId: string | null) {
  const job = await getScoutQueue().add(
    "scout.org",
    { kind: "org", orgId, actorUserId },
    { deduplication: { id: `scout-org-${orgId}` } },
  );
  return { jobId: job.id ?? null };
}

/** Emit a scoring request; collapses bursts for the same org into one pending job. */
export async function enqueueScoring(job: ScoringJob) {
  const orgId = scoringJobOrgId(job);
  const added = await getScoringQueue().add(`score.${job.kind}`, job, {
    deduplication: { id: `score-org-${orgId}` },
  });
  return { jobId: added.id ?? null };
}

export const SCOUT_SWEEP_SCHEDULER_ID = "scout-sweep";

/** Register (or update) the recurring cross-org Scout sweep. Idempotent. */
export async function registerScoutSchedule(cron: string) {
  await getScoutQueue().upsertJobScheduler(
    SCOUT_SWEEP_SCHEDULER_ID,
    { pattern: cron, tz: "Asia/Riyadh" },
    { name: "scout.sweep", data: { kind: "sweep" } },
  );
}

export async function closeQueues(): Promise<void> {
  await Promise.all([globalForQueues.__tpScoutQueue?.close(), globalForQueues.__tpScoringQueue?.close()]);
  globalForQueues.__tpScoutQueue = undefined;
  globalForQueues.__tpScoringQueue = undefined;
  await globalForRedis.__tpRedis?.quit();
  globalForRedis.__tpRedis = undefined;
}
