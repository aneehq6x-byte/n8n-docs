import { ROLE_PERMISSIONS } from "@tenderpilot/core";
import { orgProcedure, router } from "../init";
import { dashboardRouter, opportunitiesRouter } from "./opportunities";
import { scoutRouter } from "./scout";

export const appRouter = router({
  me: orgProcedure.query(({ ctx }) => ({
    user: ctx.user,
    org: ctx.membership.org,
    role: ctx.role,
    permissions: [...ROLE_PERMISSIONS[ctx.role]],
  })),
  dashboard: dashboardRouter,
  opportunities: opportunitiesRouter,
  scout: scoutRouter,
});

export type AppRouter = typeof appRouter;
