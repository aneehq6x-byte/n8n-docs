import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { rateLimit, resetRateLimit } from "../src/rate-limit";

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (!process.env.REDIS_URL && existsSync(envFile)) process.loadEnvFile(envFile);
const url = process.env.REDIS_URL;

describe.skipIf(!url)("rateLimit (Redis)", () => {
  const client = new Redis(url ?? "", { maxRetriesPerRequest: 1 });
  afterAll(() => client.quit());

  it("allows up to the limit, then blocks with a retry-after", async () => {
    const key = `test:${crypto.randomUUID()}`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await rateLimit(key, 3, 60, client));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3]?.retryAfterSeconds).toBeGreaterThan(0);
    await resetRateLimit(key, client);
    expect((await rateLimit(key, 3, 60, client)).allowed).toBe(true);
    await resetRateLimit(key, client);
  });
});

describe("rateLimit (Redis down)", () => {
  it("fails open instead of locking users out", async () => {
    const dead = new Redis("redis://127.0.0.1:1", { maxRetriesPerRequest: 0, lazyConnect: true, enableOfflineQueue: false });
    dead.on("error", () => undefined);
    const r = await rateLimit(`test:${crypto.randomUUID()}`, 1, 60, dead);
    expect(r.allowed).toBe(true);
    dead.disconnect();
  });
});
