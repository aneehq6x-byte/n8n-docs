import { TRPCError } from "@trpc/server";
import { getOrgEntitlements, latestAuditEvent, writeAudit } from "@tenderpilot/db";
import { enqueueScoutForOrg, rateLimit } from "@tenderpilot/jobs";
import { orgProcedure, requirePermission, router } from "../init";

const ENQUEUE_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("queue timeout")), ms)),
  ]);
}

export const scoutRouter = router({
  /** On-demand Scout run: needs an active plan and stays within the plan's daily allowance. */
  trigger: requirePermission("scout:run").mutation(async ({ ctx }) => {
    const ent = await getOrgEntitlements(ctx.db, ctx.orgId);
    if (!ent.active) throw new TRPCError({ code: "FORBIDDEN", message: "SUBSCRIPTION_INACTIVE" });
    const day = new Date().toISOString().slice(0, 10);
    const allowance = await rateLimit(`scout:manual:${ctx.orgId}:${day}`, ent.scoutRunsPerDay, 24 * 60 * 60);
    if (!allowance.allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "DAILY_LIMIT" });

    try {
      // Audit first: a fast worker may finish before we return, and status() compares the two timestamps.
      await writeAudit(ctx.db, { orgId: ctx.orgId, actorUserId: ctx.user.id, action: "scout.triggered" });
      const { jobId } = await withTimeout(enqueueScoutForOrg(ctx.orgId, ctx.user.id), ENQUEUE_TIMEOUT_MS);
      return { queued: true as const, jobId, remainingToday: allowance.remaining };
    } catch (err) {
      console.error("scout enqueue failed", err);
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "QUEUE_UNAVAILABLE" });
    }
  }),

  /** Last completed run + last trigger, for the "last synced" indicator. */
  status: orgProcedure.query(async ({ ctx }) => {
    const [completed, triggered] = await Promise.all([
      latestAuditEvent(ctx.db, ctx.orgId, "scout.completed"),
      latestAuditEvent(ctx.db, ctx.orgId, "scout.triggered"),
    ]);
    // A run that never completed (e.g. enqueue failed) stops counting as "running" after 10 minutes.
    const running = Boolean(
      triggered &&
        (!completed || triggered.createdAt > completed.createdAt) &&
        Date.now() - triggered.createdAt.getTime() < 10 * 60 * 1000,
    );
    return {
      lastCompletedAt: completed?.createdAt ?? null,
      lastTriggeredAt: triggered?.createdAt ?? null,
      running,
    };
  }),
});
