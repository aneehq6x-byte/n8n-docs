/**
 * Run the Scout pipeline from the CLI.
 *
 *   pnpm scout:run              # inline, all orgs — no worker/Redis needed for ingestion
 *   pnpm scout:run --queue      # enqueue on BullMQ instead (processed by `pnpm worker`)
 *   pnpm scout:run --org <id>   # a single org
 */
import { parseArgs } from "node:util";
import { closeDb, getDb, listOrgIds, runScoutForOrg } from "@tenderpilot/db";
import { buildConnectors, scoutSince } from "../src/connectors";
import { closeQueues, enqueueScoutForOrg } from "../src/queues";

const { values } = parseArgs({
  options: { queue: { type: "boolean", default: false }, org: { type: "string" } },
});

try {
  const orgIds = values.org ? [values.org] : await listOrgIds(getDb());
  for (const orgId of orgIds) {
    if (values.queue) {
      const { jobId } = await enqueueScoutForOrg(orgId, null);
      console.log(`📨 queued scout for ${orgId} (job ${jobId ?? "deduplicated"})`);
      continue;
    }
    const event = await runScoutForOrg(getDb(), orgId, { connectors: buildConnectors(), since: scoutSince() });
    console.log(
      `🛰️  ${orgId}: +${event.createdTenderIds.length} new, ~${event.updatedTenderIds.length} updated` +
        (event.failures.length ? `, ${event.failures.length} connector failure(s)` : ""),
    );
  }
} finally {
  await closeQueues();
  await closeDb();
}
