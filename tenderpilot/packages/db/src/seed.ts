import { eq } from "drizzle-orm";
import type { Database } from "./client";
import { syncReferenceData } from "./reference-data";
import { memberships } from "./schema";
import { createOrgWithOwner, createUser, EmailTakenError } from "./services/identity";
import { users } from "./schema";

export const DEMO_USER = {
  email: "demo@tenderpilot.sa",
  password: "Demo@12345",
  name: "سارة العتيبي",
} as const;

/** Idempotent demo data: a demo user who owns a demo contractor org. */
export async function seedDemo(db: Database) {
  await syncReferenceData(db);

  let user = await db.query.users.findFirst({ where: eq(users.email, DEMO_USER.email) });
  if (!user) {
    try {
      await createUser(db, { ...DEMO_USER, locale: "ar" });
    } catch (err) {
      if (!(err instanceof EmailTakenError)) throw err;
    }
    user = await db.query.users.findFirst({ where: eq(users.email, DEMO_USER.email) });
  }
  if (!user) throw new Error("demo user missing after seed");

  let membership = await db.query.memberships.findFirst({ where: eq(memberships.userId, user.id) });
  if (!membership) {
    await db.transaction((tx) =>
      createOrgWithOwner(tx, user.id, {
        nameAr: "شركة البنيان المتقدمة للمقاولات",
        nameEn: "Al-Bunyan Advanced Contracting Co.",
        crNumber: "1010456789",
      }),
    );
    membership = await db.query.memberships.findFirst({ where: eq(memberships.userId, user.id) });
  }
  if (!membership) throw new Error("demo membership missing after seed");

  return { userEmail: DEMO_USER.email, password: DEMO_USER.password, orgId: membership.orgId };
}
