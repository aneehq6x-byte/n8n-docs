import { Worker } from "bullmq";
import { SCOUT_QUEUE } from "./payloads";
import { processScoutJob } from "./processors";
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
  return [scout];
}
