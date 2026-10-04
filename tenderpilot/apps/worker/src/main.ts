import { getServerEnv } from "@tenderpilot/config";
import { closeDb } from "@tenderpilot/db";
import { closeQueues, createWorkers, registerScoutSchedule } from "@tenderpilot/jobs";
import { bootSecrets } from "./secrets";

await bootSecrets();
const env = getServerEnv();

const workers = createWorkers();
for (const worker of workers) {
  worker.on("completed", (job, result: unknown) => console.log(`[${worker.name}] ✓ ${job.name}#${job.id}`, result));
  worker.on("failed", (job, err) => console.error(`[${worker.name}] ✗ ${job?.name}#${job?.id}: ${err.message}`));
  worker.on("error", (err) => console.error(`[${worker.name}] worker error`, err));
}

await registerScoutSchedule(env.SCOUT_CRON);
console.log(
  `🛰️  TenderPilot worker up — queues [${workers.map((w) => w.name).join(", ")}], ` +
    `scout sweep "${env.SCOUT_CRON}" (Asia/Riyadh), connectors: ${env.SCOUT_CONNECTORS}`,
);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received — draining workers…`);
  await Promise.all(workers.map((w) => w.close()));
  await closeQueues();
  await closeDb();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
