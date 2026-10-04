import {
  certificationSchema,
  companyProfileSchema,
  entitySchema,
  opportunitySchema,
  tenderSchema,
  type Certification,
  type CompanyProfile,
  type Entity,
  type Opportunity,
  type Tender,
} from "@tenderpilot/core";
import type { certifications, companyProfiles, entities, opportunities, tenders } from "./schema";

/**
 * Row → domain mappers. JSON columns are only *typed* by Drizzle; parsing them
 * through the domain schemas here guarantees corrupted or legacy rows surface
 * as errors at the boundary instead of deep inside scoring or rendering.
 */

type TenderRow = typeof tenders.$inferSelect;
type EntityRow = typeof entities.$inferSelect;
type ProfileRow = typeof companyProfiles.$inferSelect;
type CertificationRow = typeof certifications.$inferSelect;
type OpportunityRow = typeof opportunities.$inferSelect;

export function toTender(row: TenderRow): Tender {
  return tenderSchema.parse({
    id: row.id,
    orgId: row.orgId,
    sourceRef: row.sourceRef,
    source: row.source,
    entityId: row.entityId,
    title: { ar: row.titleAr, en: row.titleEn },
    description: { ar: row.descriptionAr, en: row.descriptionEn },
    sector: row.sector,
    valueEstimate: row.valueEstimate,
    currency: row.currency,
    requiredClassificationField: row.requiredClassificationField,
    requiredClassificationGrade: row.requiredClassificationGrade,
    requiredCertifications: row.requiredCertifications,
    guarantee: row.guarantee,
    publishedAt: row.publishedAt,
    submissionDeadline: row.submissionDeadline,
    status: row.status,
    rawDocumentRefs: row.rawDocumentRefs,
  });
}

export function toEntity(row: EntityRow): Entity {
  return entitySchema.parse({
    id: row.id,
    orgId: row.orgId,
    name: { ar: row.nameAr, en: row.nameEn },
    kind: row.kind,
    region: row.regionAr && row.regionEn ? { ar: row.regionAr, en: row.regionEn } : null,
    website: row.website,
  });
}

export function toCompanyProfile(row: ProfileRow): CompanyProfile {
  return companyProfileSchema.parse({
    id: row.id,
    orgId: row.orgId,
    legalName: { ar: row.legalNameAr, en: row.legalNameEn },
    sectors: row.sectors,
    classifications: row.classifications,
    annualTurnover: row.annualTurnover,
    maxContractValue: row.maxContractValue,
    pastProjects: row.pastProjects,
  });
}

export function toCertification(row: CertificationRow): Certification {
  return certificationSchema.parse({
    id: row.id,
    orgId: row.orgId,
    companyProfileId: row.companyProfileId,
    type: row.type,
    issuer: row.issuer,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
  });
}

export function toOpportunity(row: OpportunityRow): Opportunity {
  return opportunitySchema.parse({
    id: row.id,
    orgId: row.orgId,
    tenderId: row.tenderId,
    companyProfileId: row.companyProfileId,
    score: row.score,
    scoreBreakdown: row.scoreBreakdown,
    status: row.status,
    assignedUserIds: row.assignedUserIds,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
