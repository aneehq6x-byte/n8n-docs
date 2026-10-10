import { ROLE_PERMISSIONS } from "@tenderpilot/core";
import { orgProcedure, router } from "../init";
import { dashboardRouter, opportunitiesRouter } from "./opportunities";
import { profileRouter } from "./profile";
import { scoutRouter } from "./scout";
import { teamRouter } from "./team";

export const appRouter = router({
  me: orgProcedure.query(({ ctx }) => ({
    user: ctx.user,
    org: ctx.membership.org,
    role: ctx.role,
    permissions: [...ROLE_PERMISSIONS[ctx.role]],
  })),
  dashboard: dashboardRouter,
  opportunities: opportunitiesRouter,
  profile: profileRouter,
  scout: scoutRouter,
  team: teamRouter,
});

export type AppRouter = typeof appRouter;
