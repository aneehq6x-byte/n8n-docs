import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { appUrl } from "@tenderpilot/config";
import { assignableRoles, can, roleSchema } from "@tenderpilot/core";
import {
  TeamError,
  changeMemberRole,
  createInvitation,
  getOrgEntitlements,
  listMembers,
  listPendingInvitations,
  removeMember,
  revokeInvitation,
  seatUsage,
  type TeamErrorCode,
} from "@tenderpilot/db";
import { getMailer, invitationEmail } from "@tenderpilot/mail";
import { orgProcedure, requirePermission, router } from "../init";

const CODE_MAP: Record<TeamErrorCode, TRPCError["code"]> = {
  FORBIDDEN_ROLE: "FORBIDDEN",
  ALREADY_MEMBER: "CONFLICT",
  SEAT_LIMIT: "PRECONDITION_FAILED",
  NOT_FOUND: "NOT_FOUND",
  OWNER_PROTECTED: "FORBIDDEN",
  EMAIL_MISMATCH: "FORBIDDEN",
  INVITE_EXPIRED: "BAD_REQUEST",
  INVITE_USED: "BAD_REQUEST",
  INVITE_REVOKED: "BAD_REQUEST",
};

/** Domain errors → tRPC errors whose `message` is the stable code the UI translates. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof TeamError) throw new TRPCError({ code: CODE_MAP[err.code], message: err.code });
    throw err;
  }
}

export const teamRouter = router({
  overview: orgProcedure.query(async ({ ctx }) => {
    const [members, invitations, seats] = await Promise.all([
      listMembers(ctx.db, ctx.orgId),
      can(ctx.role, "team:manage") ? listPendingInvitations(ctx.db, ctx.orgId) : Promise.resolve([]),
      seatUsage(ctx.db, ctx.orgId),
    ]);
    return {
      members,
      invitations,
      seats,
      me: { userId: ctx.user.id, role: ctx.role },
      canManage: can(ctx.role, "team:manage"),
      assignableRoles: assignableRoles(ctx.role),
    };
  }),

  invite: requirePermission("team:manage")
    .input(z.object({ email: z.string(), role: roleSchema, locale: z.enum(["ar", "en"]) }))
    .mutation(({ ctx, input }) =>
      run(async () => {
        if (!(await getOrgEntitlements(ctx.db, ctx.orgId)).active) {
          throw new TRPCError({ code: "FORBIDDEN", message: "SUBSCRIPTION_INACTIVE" });
        }
        const { token, invitation } = await createInvitation(ctx.db, ctx.orgId, { userId: ctx.user.id, role: ctx.role }, input);
        await getMailer().send(
          invitationEmail({
            to: invitation.email,
            orgName: { ar: ctx.membership.org.nameAr, en: ctx.membership.org.nameEn },
            inviterName: ctx.user.name,
            role: roleSchema.parse(invitation.role),
            url: `${appUrl()}/${input.locale}/invite/${token}`,
            expiresAt: invitation.expiresAt,
          }),
        );
        return { email: invitation.email };
      }),
    ),

  revokeInvitation: requirePermission("team:manage")
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) => run(() => revokeInvitation(ctx.db, ctx.orgId, { userId: ctx.user.id, role: ctx.role }, input.id))),

  changeRole: requirePermission("team:manage")
    .input(z.object({ userId: z.uuid(), role: roleSchema }))
    .mutation(({ ctx, input }) =>
      run(() => changeMemberRole(ctx.db, ctx.orgId, { userId: ctx.user.id, role: ctx.role }, input.userId, input.role)),
    ),

  /** Remove someone (team:manage) or leave yourself (any non-owner member). */
  remove: orgProcedure.input(z.object({ userId: z.uuid() })).mutation(({ ctx, input }) => {
    if (input.userId !== ctx.user.id && !can(ctx.role, "team:manage")) {
      throw new TRPCError({ code: "FORBIDDEN", message: "FORBIDDEN_ROLE" });
    }
    return run(() => removeMember(ctx.db, ctx.orgId, { userId: ctx.user.id, role: ctx.role }, input.userId));
  }),
});
