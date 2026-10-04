import { eq } from "drizzle-orm";
import { demoCertifications, demoCompanyProfile } from "@tenderpilot/core";
import type { Database } from "./client";
import { syncReferenceData } from "./reference-data";
import { memberships, users } from "./schema";
import { upsertCertifications, upsertCompanyProfile } from "./services/company-profile";
import { createOrgWithOwner, createUser, EmailTakenError } from "./services/identity";

export const DEMO_USER = {
  email: "demo@tenderpilot.sa",
  password: "Demo@12345",
  name: "سارة العتيبي",
} as const;

/**
 * Idempotent demo data: a demo user who owns a demo contractor org with a full
 * bidding profile and certifications. Tenders are NOT seeded directly — they
 * arrive through the Scout (`pnpm scout:run`), exactly as in production.
 */
export async function seedDemo(db: Database, now: Date = new Date()) {
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
  const userId = user.id;

  const template = demoCompanyProfile();
  let membership = await db.query.memberships.findFirst({ where: eq(memberships.userId, userId) });
  if (!membership) {
    await db.transaction((tx) =>
      createOrgWithOwner(tx, userId, {
        nameAr: template.legalName.ar,
        nameEn: template.legalName.en,
        crNumber: "1010456789",
        sectors: template.sectors,
        maxContractValue: template.maxContractValue,
      }),
    );
    membership = await db.query.memberships.findFirst({ where: eq(memberships.userId, userId) });
  }
  if (!membership) throw new Error("demo membership missing after seed");
  const orgId = membership.orgId;

  const profile = await db.transaction(async (tx) => {
    const saved = await upsertCompanyProfile(tx, orgId, {
      legalNameAr: template.legalName.ar,
      legalNameEn: template.legalName.en,
      sectors: template.sectors,
      classifications: template.classifications,
      annualTurnover: template.annualTurnover,
      maxContractValue: template.maxContractValue,
      pastProjects: template.pastProjects,
    });
    await upsertCertifications(
      tx,
      orgId,
      saved.id,
      demoCertifications(now).map(({ type, issuer, issuedAt, expiresAt }) => ({ type, issuer, issuedAt, expiresAt })),
    );
    return saved;
  });

  return { userEmail: DEMO_USER.email, password: DEMO_USER.password, orgId, companyProfileId: profile.id };
}
