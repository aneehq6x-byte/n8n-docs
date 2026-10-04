import { z } from "zod";

/**
 * Shared, bilingual (ar/en) vocabulary. The Scout, the scoring engine, the DB
 * mappers and the UI all speak exactly these values.
 */

export const SECTORS = [
  "construction",
  "information_technology",
  "healthcare",
  "education",
  "transport",
  "energy",
  "water",
  "facilities_management",
  "consulting",
  "security",
] as const;
export const sectorSchema = z.enum(SECTORS);
export type Sector = z.infer<typeof sectorSchema>;

/**
 * Saudi contractor classification fields (تصنيف المقاولين). A company is
 * classified per field at a grade between 1 (highest capacity) and 5 (lowest).
 */
export const CLASSIFICATION_FIELDS = [
  "buildings",
  "roads",
  "water_and_sewage",
  "electrical_works",
  "mechanical_works",
  "it_and_communications",
  "operation_and_maintenance",
  "health_services",
] as const;
export const classificationFieldSchema = z.enum(CLASSIFICATION_FIELDS);
export type ClassificationField = z.infer<typeof classificationFieldSchema>;

/** Grade 1 is the strongest capacity, grade 5 the weakest. */
export const classificationGradeSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
export type ClassificationGrade = z.infer<typeof classificationGradeSchema>;

export const CERTIFICATION_TYPES = [
  "iso_9001",
  "iso_27001",
  "iso_14001",
  "ohsas_45001",
  "saudization_nitaqat",
  "zakat_compliance",
  "gosi_compliance",
  "citc_license",
  "sfda_license",
  "local_content_baladi",
] as const;
export const certificationTypeSchema = z.enum(CERTIFICATION_TYPES);
export type CertificationType = z.infer<typeof certificationTypeSchema>;

export const TENDER_STATUSES = ["open", "closing_soon", "closed", "awarded", "cancelled"] as const;
export const tenderStatusSchema = z.enum(TENDER_STATUSES);
export type TenderStatus = z.infer<typeof tenderStatusSchema>;

export const OPPORTUNITY_STATUSES = ["new", "reviewing", "pursuing", "submitted", "won", "lost", "dismissed"] as const;
export const opportunityStatusSchema = z.enum(OPPORTUNITY_STATUSES);
export type OpportunityStatus = z.infer<typeof opportunityStatusSchema>;

/** Statuses that still need attention (used for "open opportunity" KPIs). */
export const ACTIVE_OPPORTUNITY_STATUSES: readonly OpportunityStatus[] = ["new", "reviewing", "pursuing"];

type Bilingual = { ar: string; en: string };

export const SECTOR_LABELS: Record<Sector, Bilingual> = {
  construction: { ar: "الإنشاءات والمقاولات", en: "Construction" },
  information_technology: { ar: "تقنية المعلومات", en: "Information Technology" },
  healthcare: { ar: "الرعاية الصحية", en: "Healthcare" },
  education: { ar: "التعليم", en: "Education" },
  transport: { ar: "النقل والطرق", en: "Transport" },
  energy: { ar: "الطاقة", en: "Energy" },
  water: { ar: "المياه", en: "Water" },
  facilities_management: { ar: "إدارة المرافق", en: "Facilities Management" },
  consulting: { ar: "الاستشارات", en: "Consulting" },
  security: { ar: "الأمن والسلامة", en: "Security" },
};

export const CLASSIFICATION_FIELD_LABELS: Record<ClassificationField, Bilingual> = {
  buildings: { ar: "المباني", en: "Buildings" },
  roads: { ar: "الطرق", en: "Roads" },
  water_and_sewage: { ar: "المياه والصرف الصحي", en: "Water & sewage" },
  electrical_works: { ar: "الأعمال الكهربائية", en: "Electrical works" },
  mechanical_works: { ar: "الأعمال الميكانيكية", en: "Mechanical works" },
  it_and_communications: { ar: "تقنية المعلومات والاتصالات", en: "IT & communications" },
  operation_and_maintenance: { ar: "التشغيل والصيانة", en: "Operation & maintenance" },
  health_services: { ar: "الخدمات الصحية", en: "Health services" },
};

export const CERTIFICATION_LABELS: Record<CertificationType, Bilingual> = {
  iso_9001: { ar: "آيزو 9001 لإدارة الجودة", en: "ISO 9001 Quality Management" },
  iso_27001: { ar: "آيزو 27001 لأمن المعلومات", en: "ISO 27001 Information Security" },
  iso_14001: { ar: "آيزو 14001 للإدارة البيئية", en: "ISO 14001 Environmental" },
  ohsas_45001: { ar: "آيزو 45001 للسلامة المهنية", en: "ISO 45001 Health & Safety" },
  saudization_nitaqat: { ar: "نطاقات السعودة", en: "Nitaqat Saudization" },
  zakat_compliance: { ar: "شهادة الزكاة والدخل", en: "Zakat Compliance" },
  gosi_compliance: { ar: "شهادة التأمينات الاجتماعية", en: "GOSI Compliance" },
  citc_license: { ar: "ترخيص هيئة الاتصالات", en: "CITC License" },
  sfda_license: { ar: "ترخيص هيئة الغذاء والدواء", en: "SFDA License" },
  local_content_baladi: { ar: "المحتوى المحلي (بلدي)", en: "Local Content (Baladi)" },
};
