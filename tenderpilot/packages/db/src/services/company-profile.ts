import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  certificationTypeSchema,
  heldClassificationSchema,
  pastProjectSchema,
  sectorSchema,
  type Certification,
  type CompanyProfile,
} from "@tenderpilot/core";
import type { DbExecutor } from "../client";
import { toCertification, toCompanyProfile } from "../mappers";
import { certifications, companyProfiles } from "../schema";

export const companyProfileInputSchema = z.object({
  legalNameAr: z.string().trim().min(2),
  legalNameEn: z.string().trim().min(2),
  sectors: z.array(sectorSchema).min(1),
  classifications: z.array(heldClassificationSchema).default([]),
  annualTurnover: z.number().nonnegative(),
  maxContractValue: z.number().positive(),
  pastProjects: z.array(pastProjectSchema).default([]),
});
export type CompanyProfileInput = z.input<typeof companyProfileInputSchema>;

export const certificationInputSchema = z.object({
  type: certificationTypeSchema,
  issuer: z.string().trim().min(1),
  issuedAt: z.coerce.date(),
  expiresAt: z.coerce.date().nullable(),
});
export type CertificationInput = z.input<typeof certificationInputSchema>;

export interface ProfileBundle {
  profile: CompanyProfile;
  certifications: Certification[];
}

export async function getCompanyProfile(db: DbExecutor, orgId: string): Promise<ProfileBundle | null> {
  const [row] = await db.select().from(companyProfiles).where(eq(companyProfiles.orgId, orgId)).limit(1);
  if (!row) return null;
  const certRows = await db.select().from(certifications).where(eq(certifications.companyProfileId, row.id));
  return { profile: toCompanyProfile(row), certifications: certRows.map(toCertification) };
}

/** Create or replace the org's bidding profile (one per org in Phase 1). */
export async function upsertCompanyProfile(db: DbExecutor, orgId: string, input: CompanyProfileInput): Promise<CompanyProfile> {
  const data = companyProfileInputSchema.parse(input);
  const [row] = await db
    .insert(companyProfiles)
    .values({ orgId, ...data })
    .onConflictDoUpdate({
      target: companyProfiles.orgId,
      set: { ...data, updatedAt: sql`now()` },
    })
    .returning();
  if (!row) throw new Error("company profile upsert failed");
  return toCompanyProfile(row);
}

/** Upsert certifications by (profile, type). */
export async function upsertCertifications(
  db: DbExecutor,
  orgId: string,
  companyProfileId: string,
  input: readonly CertificationInput[],
): Promise<void> {
  if (input.length === 0) return;
  const rows = input.map((c) => ({ orgId, companyProfileId, ...certificationInputSchema.parse(c) }));
  await db
    .insert(certifications)
    .values(rows)
    .onConflictDoUpdate({
      target: [certifications.companyProfileId, certifications.type],
      set: {
        issuer: sql`excluded.issuer`,
        issuedAt: sql`excluded.issued_at`,
        expiresAt: sql`excluded.expires_at`,
        updatedAt: sql`now()`,
      },
    });
}
