import { z } from "zod";
import { certificationTypeSchema, classificationFieldSchema, classificationGradeSchema, sectorSchema } from "./enums";

const isoDate = z.iso.date(); // YYYY-MM-DD from <input type="date">

/**
 * The editable bidding profile, as one document. Shared by the browser form
 * (instant validation) and the tRPC mutation (authoritative validation).
 */
export const companyProfileFormSchema = z
  .object({
    legalNameAr: z.string().trim().min(2).max(200),
    legalNameEn: z.string().trim().min(2).max(200),
    sectors: z.array(sectorSchema).min(1),
    annualTurnover: z.number().nonnegative().max(1e12),
    maxContractValue: z.number().positive().max(1e12),
    classifications: z
      .array(z.object({ field: classificationFieldSchema, grade: classificationGradeSchema }))
      .max(20)
      .refine((rows) => new Set(rows.map((r) => r.field)).size === rows.length, { message: "DUPLICATE_FIELD" }),
    certifications: z
      .array(
        z
          .object({
            type: certificationTypeSchema,
            issuer: z.string().trim().min(1).max(200),
            issuedAt: isoDate,
            expiresAt: isoDate.nullable(),
          })
          .refine((c) => c.expiresAt === null || c.expiresAt > c.issuedAt, {
            message: "EXPIRY_BEFORE_ISSUE",
            path: ["expiresAt"],
          }),
      )
      .max(30)
      .refine((rows) => new Set(rows.map((r) => r.type)).size === rows.length, { message: "DUPLICATE_CERTIFICATION" }),
    pastProjects: z
      .array(
        z.object({
          titleAr: z.string().trim().min(2).max(300),
          titleEn: z.string().trim().min(2).max(300),
          sector: sectorSchema,
          value: z.number().nonnegative().max(1e12),
          /** 0–100 in the form; stored as 0–1. */
          performancePct: z.number().min(0).max(100),
          year: z.number().int().gte(1990).lte(2100),
        }),
      )
      .max(50),
  })
  .refine((p) => p.annualTurnover === 0 || p.maxContractValue <= p.annualTurnover * 5, {
    message: "CAPACITY_UNREALISTIC",
    path: ["maxContractValue"],
  });

export type CompanyProfileForm = z.infer<typeof companyProfileFormSchema>;

/** How a profile edit moved the org's opportunities — shown right after saving. */
export interface RescoreImpact {
  scored: number;
  improved: number;
  declined: number;
  newlyEligible: number;
  newlyDisqualified: number;
  averageBefore: number | null;
  averageAfter: number | null;
}
