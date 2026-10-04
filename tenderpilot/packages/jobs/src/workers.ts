import { Worker } from "bullmq";
import { SCORING_QUEUE, SCOUT_QUEUE } from "./payloads";
import { processScoringJob, processScoutJob } from "./processors";
import { createRedisClient } from "./queues";

/**
 * Worker factories live next to the queues so the whole system shares a single
 * BullMQ instance (and its peer ioredis). Each worker gets its own connection
 * because workers hold blocking Redis commands.
 */
export function createWorkers(): Worker[] {
  const scout = new Worker(SCOUT_QUEUE, processScoutJob, {
    connection: createRedisClient(),
    // Low concurrency: be a polite client to government portals.
    concurrency: 2,
  });
  const scoring = new Worker(SCORING_QUEUE, processScoringJob, {
    connection: createRedisClient(),
    // Scoring is CPU-light and per-org deduplicated; moderate parallelism is safe.
    concurrency: 4,
  });
  return [scout, scoring];
}
