import { ROLE_PERMISSIONS } from "@tenderpilot/core";
import { orgProcedure, router } from "../init";

export const appRouter = router({
  me: orgProcedure.query(({ ctx }) => ({
    user: ctx.user,
    org: ctx.membership.org,
    role: ctx.role,
    permissions: [...ROLE_PERMISSIONS[ctx.role]],
  })),
});

export type AppRouter = typeof appRouter;
