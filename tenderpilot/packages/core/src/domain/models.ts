import { z } from "zod";
import {
  certificationTypeSchema,
  classificationFieldSchema,
  classificationGradeSchema,
  opportunityStatusSchema,
  sectorSchema,
  tenderStatusSchema,
} from "./enums";

/**
 * Zod schemas are the single source of truth for the domain. Every boundary
 * (connector output, DB rows, tRPC input/output) narrows `unknown` through
 * these — no `any` anywhere.
 */

export const bilingualTextSchema = z.object({
  ar: z.string().min(1),
  en: z.string().min(1),
});
export type BilingualText = z.infer<typeof bilingualTextSchema>;

/** A government issuer (وزارة، هيئة، أمانة …). */
export const entitySchema = z.object({
  id: z.uuid(),
  orgId: z.uuid(),
  name: bilingualTextSchema,
  /** e.g. "ministry", "authority", "municipality". */
  kind: z.string().min(1),
  region: bilingualTextSchema.nullable(),
  website: z.url().nullable(),
});
export type Entity = z.infer<typeof entitySchema>;

export const guaranteeRequirementSchema = z.object({
  /** Bid bond (الضمان الابتدائي) as a fraction of the estimated value, e.g. 0.02. */
  bidBondPct: z.number().min(0).max(1),
  /** Performance bond (الضمان النهائي) as a fraction, typically 0.05. */
  performanceBondPct: z.number().min(0).max(1),
});
export type GuaranteeRequirement = z.infer<typeof guaranteeRequirementSchema>;

export const tenderSchema = z.object({
  id: z.uuid(),
  orgId: z.uuid(),
  /** Stable reference from the source system (e.g. Etimad tender number). */
  sourceRef: z.string().min(1),
  source: z.string().min(1),
  entityId: z.uuid(),
  title: bilingualTextSchema,
  description: bilingualTextSchema,
  sector: sectorSchema,
  valueEstimate: z.number().nonnegative().nullable(),
  currency: z.literal("SAR"),
  requiredClassificationField: classificationFieldSchema.nullable(),
  /** Minimum acceptable grade; the company must hold this grade or better (lower number). */
  requiredClassificationGrade: classificationGradeSchema.nullable(),
  requiredCertifications: z.array(certificationTypeSchema),
  guarantee: guaranteeRequirementSchema,
  publishedAt: z.coerce.date(),
  /** Deadline for submitting offers (آخر موعد لتقديم العروض). */
  submissionDeadline: z.coerce.date(),
  status: tenderStatusSchema,
  rawDocumentRefs: z.array(z.string()),
});
export type Tender = z.infer<typeof tenderSchema>;

export const pastProjectSchema = z.object({
  title: bilingualTextSchema,
  sector: sectorSchema,
  value: z.number().nonnegative(),
  /** Client satisfaction / delivery score 0–1, drives past-performance alignment. */
  performanceRating: z.number().min(0).max(1),
  year: z.number().int().gte(1990).lte(2100),
});
export type PastProject = z.infer<typeof pastProjectSchema>;

export const heldClassificationSchema = z.object({
  field: classificationFieldSchema,
  grade: classificationGradeSchema,
});
export type HeldClassification = z.infer<typeof heldClassificationSchema>;

export const companyProfileSchema = z.object({
  id: z.uuid(),
  orgId: z.uuid(),
  legalName: bilingualTextSchema,
  sectors: z.array(sectorSchema).min(1),
  classifications: z.array(heldClassificationSchema),
  /** Annual turnover in SAR. */
  annualTurnover: z.number().nonnegative(),
  /** Largest single contract the company is comfortable delivering (SAR) — drives value fit. */
  maxContractValue: z.number().positive(),
  pastProjects: z.array(pastProjectSchema),
});
export type CompanyProfile = z.infer<typeof companyProfileSchema>;

export const certificationSchema = z.object({
  id: z.uuid(),
  orgId: z.uuid(),
  companyProfileId: z.uuid(),
  type: certificationTypeSchema,
  issuer: z.string().min(1),
  issuedAt: z.coerce.date(),
  /** Null means the certification does not expire. */
  expiresAt: z.coerce.date().nullable(),
});
export type Certification = z.infer<typeof certificationSchema>;

/** One explainable contribution to the final opportunity score. */
export const scoreFactorSchema = z.object({
  key: z.string(),
  labelAr: z.string(),
  labelEn: z.string(),
  /** Relative weight of this factor (all weights sum to 1). */
  weight: z.number().min(0).max(1),
  /** This factor's normalised performance, 0–1. */
  ratio: z.number().min(0).max(1),
  /** Points this factor adds to the 0–100 score (= weight × ratio × 100). */
  contribution: z.number().min(0).max(100),
  reasonAr: z.string(),
  reasonEn: z.string(),
});
export type ScoreFactor = z.infer<typeof scoreFactorSchema>;

export const scoreBreakdownSchema = z.object({
  score: z.number().min(0).max(100),
  factors: z.array(scoreFactorSchema),
  /** True when a hard eligibility gate failed (e.g. classification too low). */
  disqualified: z.boolean(),
  disqualificationReasonAr: z.string().nullable(),
  disqualificationReasonEn: z.string().nullable(),
});
export type ScoreBreakdown = z.infer<typeof scoreBreakdownSchema>;

export const opportunitySchema = z.object({
  id: z.uuid(),
  orgId: z.uuid(),
  tenderId: z.uuid(),
  companyProfileId: z.uuid(),
  score: z.number().min(0).max(100),
  scoreBreakdown: scoreBreakdownSchema,
  status: opportunityStatusSchema,
  assignedUserIds: z.array(z.uuid()),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Opportunity = z.infer<typeof opportunitySchema>;
