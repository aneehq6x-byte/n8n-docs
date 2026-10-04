import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { opportunityListInputSchema, opportunityStatusSchema } from "@tenderpilot/core";
import { getDashboardSummary, getOpportunityDetail, listOpportunities, updateOpportunityStatus } from "@tenderpilot/db";
import { enqueueScoring } from "@tenderpilot/jobs";
import { requirePermission, router } from "../init";

const idInput = z.object({ id: z.uuid() });

export const opportunitiesRouter = router({
  /** Filterable, sortable, searchable, paginated list — always scoped to the caller's org. */
  list: requirePermission("opportunity:read")
    .input(opportunityListInputSchema)
    .query(({ ctx, input }) => listOpportunities(ctx.db, ctx.orgId, input)),

  get: requirePermission("opportunity:read")
    .input(idInput)
    .query(async ({ ctx, input }) => {
      const detail = await getOpportunityDetail(ctx.db, ctx.orgId, input.id);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND" });
      return detail;
    }),

  /** The explainable score breakdown on its own (e.g. for a tooltip or export). */
  explain: requirePermission("opportunity:read")
    .input(idInput)
    .query(async ({ ctx, input }) => {
      const detail = await getOpportunityDetail(ctx.db, ctx.orgId, input.id);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND" });
      return { scoredAt: detail.scoredAt, ...detail.opportunity.scoreBreakdown };
    }),

  updateStatus: requirePermission("opportunity:update")
    .input(z.object({ id: z.uuid(), status: opportunityStatusSchema }))
    .mutation(async ({ ctx, input }) => {
      const ok = await updateOpportunityStatus(ctx.db, ctx.orgId, input.id, input.status, ctx.user.id);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND" });
      return { id: input.id, status: input.status };
    }),

  /** Request a full re-score (e.g. after editing the company profile). */
  rescore: requirePermission("profile:manage").mutation(async ({ ctx }) => {
    try {
      return await enqueueScoring({ kind: "manual", orgId: ctx.orgId, actorUserId: ctx.user.id });
    } catch {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "QUEUE_UNAVAILABLE" });
    }
  }),
});

export const dashboardRouter = router({
  summary: requirePermission("opportunity:read").query(({ ctx }) => getDashboardSummary(ctx.db, ctx.orgId)),
});
