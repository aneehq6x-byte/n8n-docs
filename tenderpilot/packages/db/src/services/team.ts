import { and, asc, count, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { canManageRole, roleSchema, type Role } from "@tenderpilot/core";
import { writeAudit } from "../audit";
import type { Database, DbExecutor } from "../client";
import { invitations, memberships, orgs, subscriptions, users } from "../schema";
import { generateToken, hashToken } from "../tokens";

export const TEAM_ERRORS = [
  "FORBIDDEN_ROLE",
  "ALREADY_MEMBER",
  "SEAT_LIMIT",
  "NOT_FOUND",
  "OWNER_PROTECTED",
  "EMAIL_MISMATCH",
  "INVITE_EXPIRED",
  "INVITE_USED",
  "INVITE_REVOKED",
] as const;
export type TeamErrorCode = (typeof TEAM_ERRORS)[number];

export class TeamError extends Error {
  constructor(readonly code: TeamErrorCode) {
    super(code);
  }
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const inviteInputSchema = z.object({
  email: z.email().trim().toLowerCase(),
  role: roleSchema.exclude(["owner"]),
});

export interface Actor {
  userId: string;
  role: Role;
}

export async function listMembers(db: Database, orgId: string) {
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: memberships.role,
      joinedAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .orderBy(asc(memberships.createdAt));
  return rows.map((r) => ({ ...r, role: roleSchema.parse(r.role) }));
}

const pendingInvite = (orgId: string, now: Date) =>
  and(eq(invitations.orgId, orgId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, now));

export async function listPendingInvitations(db: Database, orgId: string, now: Date = new Date()) {
  const rows = await db
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .where(pendingInvite(orgId, now))
    .orderBy(asc(invitations.createdAt));
  return rows.map((r) => ({ ...r, role: roleSchema.parse(r.role) }));
}

/** Seats in use = members + pending invitations; the cap comes from the subscription. */
export async function seatUsage(db: DbExecutor, orgId: string, now: Date = new Date()) {
  const [[m], [i], [sub]] = await Promise.all([
    db.select({ n: count() }).from(memberships).where(eq(memberships.orgId, orgId)),
    db.select({ n: count() }).from(invitations).where(pendingInvite(orgId, now)),
    db.select({ seats: subscriptions.seats }).from(subscriptions).where(eq(subscriptions.orgId, orgId)),
  ]);
  const members = m?.n ?? 0;
  const pending = i?.n ?? 0;
  return { members, pending, used: members + pending, limit: sub?.seats ?? 1 };
}

/** Invite by email. Re-inviting an address replaces its previous pending invitation. */
export async function createInvitation(db: Database, orgId: string, actor: Actor, input: unknown, now: Date = new Date()) {
  const { email, role } = inviteInputSchema.parse(input);
  if (!canManageRole(actor.role, role)) throw new TeamError("FORBIDDEN_ROLE");

  return db.transaction(async (tx) => {
    const [existingMember] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.orgId, orgId), eq(users.email, email)))
      .limit(1);
    if (existingMember) throw new TeamError("ALREADY_MEMBER");

    await tx
      .update(invitations)
      .set({ revokedAt: now })
      .where(and(pendingInvite(orgId, now), eq(invitations.email, email)));

    const seats = await seatUsage(tx, orgId, now);
    if (seats.used >= seats.limit) throw new TeamError("SEAT_LIMIT");

    const { token, hash } = generateToken();
    const [invite] = await tx
      .insert(invitations)
      .values({ orgId, email, role, tokenHash: hash, invitedByUserId: actor.userId, expiresAt: new Date(now.getTime() + INVITE_TTL_MS) })
      .returning({ id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt });
    if (!invite) throw new Error("invitation insert failed");
    await writeAudit(tx, {
      orgId,
      actorUserId: actor.userId,
      action: "invitation.created",
      targetType: "invitation",
      targetId: invite.id,
      metadata: { email, role },
    });
    return { token, invitation: invite };
  });
}

export async function revokeInvitation(db: Database, orgId: string, actor: Actor, invitationId: string, now: Date = new Date()) {
  return db.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(invitations)
      .where(and(eq(invitations.id, invitationId), pendingInvite(orgId, now)))
      .limit(1);
    if (!invite) throw new TeamError("NOT_FOUND");
    if (!canManageRole(actor.role, roleSchema.parse(invite.role))) throw new TeamError("FORBIDDEN_ROLE");
    await tx.update(invitations).set({ revokedAt: now }).where(eq(invitations.id, invitationId));
    await writeAudit(tx, { orgId, actorUserId: actor.userId, action: "invitation.revoked", targetType: "invitation", targetId: invitationId });
  });
}

export type InvitationStatus = "valid" | "expired" | "used" | "revoked";

/** Public lookup for the accept page — reveals only what the invitee needs. */
export async function getInvitationByToken(db: Database, token: string, now: Date = new Date()) {
  const [row] = await db
    .select({ invite: invitations, org: { nameAr: orgs.nameAr, nameEn: orgs.nameEn } })
    .from(invitations)
    .innerJoin(orgs, eq(orgs.id, invitations.orgId))
    .where(eq(invitations.tokenHash, hashToken(token)))
    .limit(1);
  if (!row) return null;
  const { invite } = row;
  const status: InvitationStatus = invite.acceptedAt
    ? "used"
    : invite.revokedAt
      ? "revoked"
      : invite.expiresAt <= now
        ? "expired"
        : "valid";
  return { status, email: invite.email, role: roleSchema.parse(invite.role), orgId: invite.orgId, org: row.org };
}

/** Join the org. The signed-in account's email must match the invited address. */
export async function acceptInvitation(db: Database, token: string, user: { id: string; email: string }, now: Date = new Date()) {
  return db.transaction(async (tx) => {
    const [invite] = await tx.select().from(invitations).where(eq(invitations.tokenHash, hashToken(token))).limit(1).for("update");
    if (!invite) throw new TeamError("NOT_FOUND");
    if (invite.acceptedAt) throw new TeamError("INVITE_USED");
    if (invite.revokedAt) throw new TeamError("INVITE_REVOKED");
    if (invite.expiresAt <= now) throw new TeamError("INVITE_EXPIRED");
    if (invite.email !== user.email.trim().toLowerCase()) throw new TeamError("EMAIL_MISMATCH");

    await tx
      .insert(memberships)
      .values({ orgId: invite.orgId, userId: user.id, role: roleSchema.parse(invite.role) })
      .onConflictDoNothing({ target: [memberships.orgId, memberships.userId] });
    await tx.update(invitations).set({ acceptedAt: now }).where(eq(invitations.id, invite.id));
    await writeAudit(tx, {
      orgId: invite.orgId,
      actorUserId: user.id,
      action: "member.joined",
      targetType: "user",
      targetId: user.id,
      metadata: { role: invite.role, invitationId: invite.id },
    });
    return { orgId: invite.orgId };
  });
}

async function memberRole(tx: DbExecutor, orgId: string, userId: string): Promise<Role | null> {
  const [m] = await tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
    .limit(1);
  return m ? roleSchema.parse(m.role) : null;
}

export async function changeMemberRole(db: Database, orgId: string, actor: Actor, targetUserId: string, role: Role) {
  return db.transaction(async (tx) => {
    const current = await memberRole(tx, orgId, targetUserId);
    if (!current) throw new TeamError("NOT_FOUND");
    if (current === "owner") throw new TeamError("OWNER_PROTECTED");
    if (!canManageRole(actor.role, current) || !canManageRole(actor.role, role)) throw new TeamError("FORBIDDEN_ROLE");
    await tx
      .update(memberships)
      .set({ role })
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, targetUserId)));
    await writeAudit(tx, {
      orgId,
      actorUserId: actor.userId,
      action: "member.role_changed",
      targetType: "user",
      targetId: targetUserId,
      metadata: { from: current, to: role },
    });
  });
}

/** Remove a member, or leave the org yourself. The owner can't be removed. */
export async function removeMember(db: Database, orgId: string, actor: Actor, targetUserId: string) {
  return db.transaction(async (tx) => {
    const current = await memberRole(tx, orgId, targetUserId);
    if (!current) throw new TeamError("NOT_FOUND");
    if (current === "owner") throw new TeamError("OWNER_PROTECTED");
    const leaving = targetUserId === actor.userId;
    if (!leaving && !canManageRole(actor.role, current)) throw new TeamError("FORBIDDEN_ROLE");
    await tx.delete(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, targetUserId)));
    await writeAudit(tx, {
      orgId,
      actorUserId: actor.userId,
      action: "member.removed",
      targetType: "user",
      targetId: targetUserId,
      metadata: { role: current, leaving },
    });
  });
}
