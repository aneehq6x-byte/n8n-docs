import { TRPCError } from "@trpc/server";
import { companyProfileFormSchema } from "@tenderpilot/core";
import { getCompanyProfileForm, saveCompanyProfile } from "@tenderpilot/db";
import { requirePermission, router } from "../init";

export const profileRouter = router({
  /** Any member can read the bidding profile — it explains every score they see. */
  get: requirePermission("opportunity:read").query(async ({ ctx }) => {
    const form = await getCompanyProfileForm(ctx.db, ctx.orgId);
    if (!form) throw new TRPCError({ code: "NOT_FOUND" });
    return form;
  }),

  /** Save + re-score; returns how the change moved the org's opportunities. */
  update: requirePermission("profile:manage")
    .input(companyProfileFormSchema)
    .mutation(({ ctx, input }) => saveCompanyProfile(ctx.db, ctx.orgId, input, ctx.user.id)),
});
