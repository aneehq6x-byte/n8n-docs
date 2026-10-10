import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { appUrl } from "@tenderpilot/config";
import { PURCHASABLE_PLANS, PLANS, billingIntervalSchema, can, purchasablePlanSchema, quote } from "@tenderpilot/core";
import { getOrgEntitlements, listCheckouts, startCheckout } from "@tenderpilot/db";
import { getPaymentGateway } from "@tenderpilot/payments";
import { orgProcedure, requirePermission, router } from "../init";

export const billingRouter = router({
  overview: orgProcedure.query(async ({ ctx }) => {
    const canManage = can(ctx.role, "billing:manage");
    const [entitlements, history] = await Promise.all([
      getOrgEntitlements(ctx.db, ctx.orgId),
      canManage ? listCheckouts(ctx.db, ctx.orgId) : Promise.resolve([]),
    ]);
    return {
      entitlements,
      history,
      canManage,
      checkoutEnabled: getPaymentGateway() !== null,
      plans: PURCHASABLE_PLANS.map((id) => ({
        id,
        seats: PLANS[id].seats,
        scoutRunsPerDay: PLANS[id].scoutRunsPerDay,
        monthly: quote(id, "monthly"),
        annual: quote(id, "annual"),
      })),
    };
  }),

  /** Creates a hosted Moyasar invoice and returns its payment URL. Return URLs are built server-side only. */
  checkout: requirePermission("billing:manage")
    .input(z.object({ plan: purchasablePlanSchema, interval: billingIntervalSchema, locale: z.enum(["ar", "en"]) }))
    .mutation(async ({ ctx, input }) => {
      const gateway = getPaymentGateway();
      if (!gateway) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "CHECKOUT_DISABLED" });
      const base = appUrl();
      try {
        return await startCheckout(ctx.db, gateway, {
          orgId: ctx.orgId,
          plan: input.plan,
          interval: input.interval,
          actorUserId: ctx.user.id,
          description: `TenderPilot ${input.plan} (${input.interval}) — ${ctx.membership.org.nameEn}`,
          urls: (checkoutId) => ({
            successUrl: `${base}/${input.locale}/billing/return?checkout=${checkoutId}`,
            backUrl: `${base}/${input.locale}/billing`,
            callbackUrl: `${base}/api/billing/moyasar`,
          }),
        });
      } catch (err) {
        console.error("checkout failed", err);
        throw new TRPCError({ code: "BAD_GATEWAY", message: "GATEWAY_ERROR" });
      }
    }),
});
