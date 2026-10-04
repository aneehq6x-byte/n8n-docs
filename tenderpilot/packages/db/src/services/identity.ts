import bcrypt from "bcryptjs";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { roleSchema, sectorSchema, type Role } from "@tenderpilot/core";
import { writeAudit } from "../audit";
import { upsertCompanyProfile } from "./company-profile";
import type { Database, DbExecutor } from "../client";
import { memberships, orgs, subscriptions, users } from "../schema";

export const signUpInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().trim().toLowerCase(),
  password: z.string().min(8).max(200),
  locale: z.enum(["ar", "en"]).default("ar"),
});
export type SignUpInput = z.infer<typeof signUpInputSchema>;

export class EmailTakenError extends Error {
  constructor() {
    super("EMAIL_TAKEN");
  }
}

export async function createUser(db: Database, input: SignUpInput) {
  const data = signUpInputSchema.parse(input);
  const existing = await db.query.users.findFirst({ where: eq(users.email, data.email) });
  if (existing) throw new EmailTakenError();
  const passwordHash = await bcrypt.hash(data.password, 12);
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ name: data.name, email: data.email, passwordHash, locale: data.locale })
      .returning({ id: users.id, email: users.email, name: users.name });
    if (!user) throw new Error("user insert failed");
    await writeAudit(tx, { orgId: null, actorUserId: user.id, action: "user.signed_up" });
    return user;
  });
}

let dummyHash: string | undefined;

/** Returns the user when the email/password pair is valid, otherwise null. */
export async function verifyCredentials(db: Database, email: string, password: string) {
  const user = await db.query.users.findFirst({ where: eq(users.email, email.trim().toLowerCase()) });
  if (!user) {
    // Still run a hash comparison so response time doesn't reveal which emails exist.
    dummyHash ??= await bcrypt.hash("tenderpilot-timing-guard", 12);
    await bcrypt.compare(password, dummyHash);
    return null;
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? { id: user.id, email: user.email, name: user.name, locale: user.locale } : null;
}

export const createOrgInputSchema = z.object({
  nameAr: z.string().trim().min(2).max(200),
  nameEn: z.string().trim().min(2).max(200),
  crNumber: z
    .string()
    .trim()
    .regex(/^\d{10}$/, "CR number must be 10 digits")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  /** Seed the bidding profile so the very first Scout run produces scored opportunities. */
  sectors: z.array(sectorSchema).min(1),
  maxContractValue: z.coerce.number().positive().max(10_000_000_000),
});
export type CreateOrgInput = z.input<typeof createOrgInputSchema>;

function slugify(nameEn: string): string {
  const base = nameEn
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${base || "org"}-${Math.random().toString(36).slice(2, 8)}`;
}

const TRIAL_DAYS = 14;

/** Create an org with the caller as owner, on a trial subscription — atomically. */
export async function createOrgWithOwner(tx: DbExecutor, ownerUserId: string, input: CreateOrgInput) {
  const data = createOrgInputSchema.parse(input);
  const [org] = await tx
    .insert(orgs)
    .values({ slug: slugify(data.nameEn), nameAr: data.nameAr, nameEn: data.nameEn, crNumber: data.crNumber ?? null })
    .returning();
  if (!org) throw new Error("org insert failed");
  await tx.insert(memberships).values({ orgId: org.id, userId: ownerUserId, role: "owner" });
  await tx.insert(subscriptions).values({
    orgId: org.id,
    plan: "trial",
    status: "trialing",
    currentPeriodEnd: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
  });
  await upsertCompanyProfile(tx, org.id, {
    legalNameAr: data.nameAr,
    legalNameEn: data.nameEn,
    sectors: data.sectors,
    maxContractValue: data.maxContractValue,
    // Typical Saudi contractor: turnover ≈ 2× largest comfortable contract. Editable later.
    annualTurnover: data.maxContractValue * 2,
  });
  await writeAudit(tx, { orgId: org.id, actorUserId: ownerUserId, action: "org.created", targetType: "org", targetId: org.id });
  return org;
}

export interface MembershipContext {
  orgId: string;
  role: Role;
  org: { id: string; slug: string; nameAr: string; nameEn: string };
}

/** All orgs the user belongs to, oldest first. */
export async function getUserMemberships(db: Database, userId: string): Promise<MembershipContext[]> {
  const rows = await db.query.memberships.findMany({
    where: eq(memberships.userId, userId),
    with: { org: { columns: { id: true, slug: true, nameAr: true, nameEn: true } } },
    orderBy: asc(memberships.createdAt),
  });
  return rows.map((m) => ({ orgId: m.orgId, role: roleSchema.parse(m.role), org: m.org }));
}
