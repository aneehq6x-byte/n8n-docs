import { z } from "zod";
import { certificationTypeSchema, classificationFieldSchema, classificationGradeSchema, sectorSchema } from "./enums";

/**
 * The ingestion contract: the normalised-but-not-yet-persisted shape every
 * tender source must produce. Dates are ISO strings (wire-friendly). A
 * malformed upstream feed fails here, loudly, instead of reaching the database.
 */
export const rawTenderSchema = z.object({
  sourceRef: z.string().min(1),
  source: z.string().min(1),
  entity: z.object({
    nameAr: z.string().min(1),
    nameEn: z.string().min(1),
    kind: z.string().min(1),
    regionAr: z.string().nullable(),
    regionEn: z.string().nullable(),
  }),
  titleAr: z.string().min(1),
  titleEn: z.string().min(1),
  descriptionAr: z.string().min(1),
  descriptionEn: z.string().min(1),
  sector: sectorSchema,
  valueEstimate: z.number().nonnegative().nullable(),
  requiredClassificationField: classificationFieldSchema.nullable(),
  requiredClassificationGrade: classificationGradeSchema.nullable(),
  requiredCertifications: z.array(certificationTypeSchema),
  bidBondPct: z.number().min(0).max(1),
  performanceBondPct: z.number().min(0).max(1),
  publishedAt: z.iso.datetime(),
  submissionDeadline: z.iso.datetime(),
  rawDocumentRefs: z.array(z.string()),
});
export type RawTender = z.infer<typeof rawTenderSchema>;
