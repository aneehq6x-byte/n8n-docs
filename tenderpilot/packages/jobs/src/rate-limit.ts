import type { Redis } from "ioredis";
import { redisConnection } from "./queues";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Fixed-window limiter: INCR + EXPIRE (set only on the first hit) in one MULTI.
 * Fails OPEN when Redis is unavailable — a cache outage must not lock every
 * user out of sign-in; the outage is logged instead.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  client: Redis = redisConnection(),
): Promise<RateLimitResult> {
  const redisKey = `rl:${key}`;
  try {
    const result = await Promise.race([
      client.multi().incr(redisKey).expire(redisKey, windowSeconds, "NX").ttl(redisKey).exec(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("rate limit timeout")), 1_000)),
    ]);
    const hits = Number(result?.[0]?.[1] ?? 0);
    const ttl = Number(result?.[2]?.[1] ?? windowSeconds);
    return {
      allowed: hits <= limit,
      remaining: Math.max(0, limit - hits),
      retryAfterSeconds: hits <= limit ? 0 : Math.max(1, ttl),
    };
  } catch (err) {
    console.warn(`rate limiter unavailable for ${key} — failing open`, err instanceof Error ? err.message : err);
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }
}

/** Clear a key, e.g. after a successful sign-in resets the per-account counter. */
export async function resetRateLimit(key: string, client: Redis = redisConnection()): Promise<void> {
  try {
    await client.del(`rl:${key}`);
  } catch {
    // best effort
  }
}
