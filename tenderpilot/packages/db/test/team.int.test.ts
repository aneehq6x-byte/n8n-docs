import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../src/client";
import { syncReferenceData } from "../src/reference-data";
import { invitations, orgs, passwordResetTokens, subscriptions, users } from "../src/schema";
import { createOrgWithOwner, createUser, verifyCredentials } from "../src/services/identity";
import { isResetTokenValid, requestPasswordReset, resetPassword } from "../src/services/password-reset";
import {
  TeamError,
  acceptInvitation,
  changeMemberRole,
  createInvitation,
  getInvitationByToken,
  listMembers,
  removeMember,
  seatUsage,
} from "../src/services/team";
import { hashToken } from "../src/tokens";

const url = process.env.DATABASE_URL;
const uniq = () => crypto.randomUUID().slice(0, 8);
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (e) {
    return e instanceof TeamError ? e.code : String(e);
  }
};

describe.skipIf(!url)("team & account security (Postgres)", () => {
  let handle: DbHandle;
  const userIds: string[] = [];
  const orgIds: string[] = [];

  async function user(name: string) {
    const u = await createUser(handle.db, { name, email: `${name}-${uniq()}@tenderpilot.test`, password: "Passw0rd!x", locale: "ar" });
    userIds.push(u.id);
    return u;
  }

  async function org(owner: { id: string }, seats = 5) {
    const o = await handle.db.transaction((tx) =>
      createOrgWithOwner(tx, owner.id, { nameAr: "منشأة", nameEn: "Org", sectors: ["construction"], maxContractValue: 1_000_000 }),
    );
    orgIds.push(o.id);
    await handle.db.update(subscriptions).set({ seats }).where(eq(subscriptions.orgId, o.id));
    return o.id;
  }

  beforeAll(async () => {
    handle = createDb(url ?? "", { max: 2 });
    await syncReferenceData(handle.db);
  });

  afterAll(async () => {
    for (const id of orgIds) await handle.db.delete(orgs).where(eq(orgs.id, id));
    for (const id of userIds) await handle.db.delete(users).where(eq(users.id, id));
    await handle.close();
  });

  it("invite → accept: stores only a token hash, joins with the invited role, single use", async () => {
    const owner = await user("owner");
    const invitee = await user("analyst");
    const orgId = await org(owner);
    const { token } = await createInvitation(handle.db, orgId, { userId: owner.id, role: "owner" }, { email: invitee.email, role: "analyst" });

    const [stored] = await handle.db.select().from(invitations).where(eq(invitations.orgId, orgId));
    expect(stored?.tokenHash).toBe(hashToken(token));
    expect(stored?.tokenHash).not.toContain(token);

    expect((await getInvitationByToken(handle.db, token))?.status).toBe("valid");
    await acceptInvitation(handle.db, token, invitee);
    const members = await listMembers(handle.db, orgId);
    expect(members.find((m) => m.userId === invitee.id)?.role).toBe("analyst");
    expect(await code(acceptInvitation(handle.db, token, invitee))).toBe("INVITE_USED");
  });

  it("rejects acceptance by a different account than the invited email", async () => {
    const owner = await user("owner2");
    const stranger = await user("stranger");
    const orgId = await org(owner);
    const { token } = await createInvitation(handle.db, orgId, { userId: owner.id, role: "owner" }, { email: `someone-${uniq()}@x.sa`, role: "viewer" });
    expect(await code(acceptInvitation(handle.db, token, stranger))).toBe("EMAIL_MISMATCH");
  });

  it("enforces the role hierarchy", async () => {
    const owner = await user("owner3");
    const orgId = await org(owner);
    const admin = { userId: owner.id, role: "admin" as const };
    expect(await code(createInvitation(handle.db, orgId, admin, { email: `a-${uniq()}@x.sa`, role: "admin" }))).toBe("FORBIDDEN_ROLE");
    expect(await code(createInvitation(handle.db, orgId, admin, { email: `a-${uniq()}@x.sa`, role: "viewer" }))).toBe("OK");
    expect(await code(createInvitation(handle.db, orgId, { userId: owner.id, role: "analyst" }, { email: `a-${uniq()}@x.sa`, role: "viewer" }))).toBe(
      "FORBIDDEN_ROLE",
    );
    // owner can never be granted through invitations (schema rejects it outright)
    await expect(createInvitation(handle.db, orgId, { userId: owner.id, role: "owner" }, { email: `a-${uniq()}@x.sa`, role: "owner" })).rejects.toThrow();
  });

  it("enforces seat limits counting pending invitations; re-inviting an email doesn't consume a seat", async () => {
    const owner = await user("owner4");
    const orgId = await org(owner, 2);
    const actor = { userId: owner.id, role: "owner" as const };
    const email = `seat-${uniq()}@x.sa`;
    await createInvitation(handle.db, orgId, actor, { email, role: "viewer" });
    expect(await code(createInvitation(handle.db, orgId, actor, { email, role: "analyst" }))).toBe("OK"); // replaces
    expect((await seatUsage(handle.db, orgId)).used).toBe(2);
    expect(await code(createInvitation(handle.db, orgId, actor, { email: `other-${uniq()}@x.sa`, role: "viewer" }))).toBe("SEAT_LIMIT");
  });

  it("refuses expired invitations", async () => {
    const owner = await user("owner5");
    const invitee = await user("late");
    const orgId = await org(owner);
    const past = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const { token } = await createInvitation(handle.db, orgId, { userId: owner.id, role: "owner" }, { email: invitee.email, role: "viewer" }, past);
    expect((await getInvitationByToken(handle.db, token))?.status).toBe("expired");
    expect(await code(acceptInvitation(handle.db, token, invitee))).toBe("INVITE_EXPIRED");
  });

  it("protects the owner and lets members leave", async () => {
    const owner = await user("owner6");
    const member = await user("member");
    const orgId = await org(owner);
    const { token } = await createInvitation(handle.db, orgId, { userId: owner.id, role: "owner" }, { email: member.email, role: "admin" });
    await acceptInvitation(handle.db, token, member);
    const asAdmin = { userId: member.id, role: "admin" as const };
    expect(await code(removeMember(handle.db, orgId, asAdmin, owner.id))).toBe("OWNER_PROTECTED");
    expect(await code(changeMemberRole(handle.db, orgId, asAdmin, owner.id, "viewer"))).toBe("OWNER_PROTECTED");
    expect(await code(removeMember(handle.db, orgId, asAdmin, member.id))).toBe("OK"); // leaving
    expect((await listMembers(handle.db, orgId)).map((m) => m.userId)).toEqual([owner.id]);
  });

  it("password reset: unknown emails reveal nothing, tokens are single-use and expire", async () => {
    expect(await requestPasswordReset(handle.db, `nobody-${uniq()}@x.sa`)).toBeNull();

    const u = await user("forgetful");
    const first = await requestPasswordReset(handle.db, u.email);
    const second = await requestPasswordReset(handle.db, u.email);
    if (!first || !second) throw new Error("expected tokens");
    expect(await isResetTokenValid(handle.db, first.token)).toBe(true);

    expect(await resetPassword(handle.db, second.token, "NewPassw0rd!")).toBe(true);
    expect(await verifyCredentials(handle.db, u.email, "NewPassw0rd!")).not.toBeNull();
    expect(await verifyCredentials(handle.db, u.email, "Passw0rd!x")).toBeNull();
    // the other outstanding token was burned too, and reuse fails
    expect(await resetPassword(handle.db, first.token, "Another1!")).toBe(false);
    expect(await resetPassword(handle.db, second.token, "Another1!")).toBe(false);

    const old = await requestPasswordReset(handle.db, u.email, new Date(Date.now() - 2 * 60 * 60 * 1000));
    if (!old) throw new Error("expected token");
    expect(await isResetTokenValid(handle.db, old.token)).toBe(false);
    const rows = await handle.db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, u.id));
    expect(rows.every((r) => r.tokenHash.length === 64)).toBe(true);
  });
});
