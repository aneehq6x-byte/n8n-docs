import "server-only";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { can, type Permission } from "@tenderpilot/core";
import { getDb } from "@tenderpilot/db";
import { getSessionUser } from "../auth";
import { resolveActiveMembership } from "../org-context";

export async function createTRPCContext() {
  return { user: await getSessionUser() };
}
export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { user: ctx.user, db: getDb() } });
});

/** Tenant-scoped: every query below this runs against the caller's active org only. */
export const orgProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const membership = await resolveActiveMembership(ctx.user.id);
  if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "NO_ORG" });
  return next({ ctx: { orgId: membership.orgId, role: membership.role, membership } });
});

/** RBAC gate on top of org scoping. */
export function requirePermission(permission: Permission) {
  return orgProcedure.use(({ ctx, next }) => {
    if (!can(ctx.role, permission)) {
      throw new TRPCError({ code: "FORBIDDEN", message: `MISSING_PERMISSION:${permission}` });
    }
    return next();
  });
}
