import { relations } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  CertificationType,
  ClassificationField,
  GuaranteeRequirement,
  HeldClassification,
  OpportunityStatus,
  PastProject,
  ScoreBreakdown,
  Sector,
  TenderStatus,
} from "@tenderpilot/core";
import { auditColumns } from "./columns";
import { orgs } from "./platform";

/**
 * Phase 1 domain tables. All are org-scoped (multi-tenant) with audit
 * timestamps. JSON columns are typed here and re-validated with Zod when read
 * (see mappers.ts) — the database is a boundary too.
 */

const orgRef = () =>
  uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" });

export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgRef(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    kind: text("kind").notNull(),
    regionAr: text("region_ar"),
    regionEn: text("region_en"),
    website: text("website"),
    ...auditColumns,
  },
  (t) => [unique("entities_org_name_unique").on(t.orgId, t.nameEn)],
);

export const tenders = pgTable(
  "tenders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgRef(),
    source: text("source").notNull(),
    sourceRef: text("source_ref").notNull(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id),
    titleAr: text("title_ar").notNull(),
    titleEn: text("title_en").notNull(),
    descriptionAr: text("description_ar").notNull(),
    descriptionEn: text("description_en").notNull(),
    sector: text("sector").$type<Sector>().notNull(),
    valueEstimate: doublePrecision("value_estimate"),
    currency: text("currency").$type<"SAR">().notNull().default("SAR"),
    requiredClassificationField: text("required_classification_field").$type<ClassificationField>(),
    requiredClassificationGrade: integer("required_classification_grade"),
    requiredCertifications: jsonb("required_certifications").$type<CertificationType[]>().notNull().default([]),
    guarantee: jsonb("guarantee").$type<GuaranteeRequirement>().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    submissionDeadline: timestamp("submission_deadline", { withTimezone: true }).notNull(),
    status: text("status").$type<TenderStatus>().notNull(),
    /** Object-storage keys / source URIs for the tender booklet and annexes. */
    rawDocumentRefs: jsonb("raw_document_refs").$type<string[]>().notNull().default([]),
    ...auditColumns,
  },
  (t) => [
    // Idempotent ingestion: one row per (org, source, source ref).
    unique("tenders_source_ref_unique").on(t.orgId, t.source, t.sourceRef),
    index("tenders_org_deadline_idx").on(t.orgId, t.submissionDeadline),
    index("tenders_org_sector_idx").on(t.orgId, t.sector),
  ],
);

export const companyProfiles = pgTable(
  "company_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgRef(),
    legalNameAr: text("legal_name_ar").notNull(),
    legalNameEn: text("legal_name_en").notNull(),
    sectors: jsonb("sectors").$type<Sector[]>().notNull().default([]),
    classifications: jsonb("classifications").$type<HeldClassification[]>().notNull().default([]),
    annualTurnover: doublePrecision("annual_turnover").notNull(),
    maxContractValue: doublePrecision("max_contract_value").notNull(),
    pastProjects: jsonb("past_projects").$type<PastProject[]>().notNull().default([]),
    ...auditColumns,
  },
  // Phase 1: one bidding profile per org (multiple profiles / subsidiaries is a later extension).
  (t) => [unique("company_profiles_org_unique").on(t.orgId)],
);

export const certifications = pgTable(
  "certifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgRef(),
    companyProfileId: uuid("company_profile_id")
      .notNull()
      .references(() => companyProfiles.id, { onDelete: "cascade" }),
    type: text("type").$type<CertificationType>().notNull(),
    issuer: text("issuer").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...auditColumns,
  },
  (t) => [
    index("certifications_profile_idx").on(t.companyProfileId),
    unique("certifications_profile_type_unique").on(t.companyProfileId, t.type),
  ],
);

export const opportunities = pgTable(
  "opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgRef(),
    tenderId: uuid("tender_id")
      .notNull()
      .references(() => tenders.id, { onDelete: "cascade" }),
    companyProfileId: uuid("company_profile_id")
      .notNull()
      .references(() => companyProfiles.id, { onDelete: "cascade" }),
    score: doublePrecision("score").notNull(),
    scoreBreakdown: jsonb("score_breakdown").$type<ScoreBreakdown>().notNull(),
    /** Denormalised from the breakdown so lists can filter without parsing JSON. */
    disqualified: boolean("disqualified").notNull().default(false),
    status: text("status").$type<OpportunityStatus>().notNull().default("new"),
    assignedUserIds: jsonb("assigned_user_ids").$type<string[]>().notNull().default([]),
    scoredAt: timestamp("scored_at", { withTimezone: true }).notNull().defaultNow(),
    ...auditColumns,
  },
  (t) => [
    // One opportunity per (tender, profile) — refreshed in place on re-score.
    unique("opportunities_pair_unique").on(t.tenderId, t.companyProfileId),
    index("opportunities_org_score_idx").on(t.orgId, t.score),
    index("opportunities_org_status_idx").on(t.orgId, t.status),
  ],
);

export const entitiesRelations = relations(entities, ({ many, one }) => ({
  org: one(orgs, { fields: [entities.orgId], references: [orgs.id] }),
  tenders: many(tenders),
}));

export const tendersRelations = relations(tenders, ({ one, many }) => ({
  entity: one(entities, { fields: [tenders.entityId], references: [entities.id] }),
  opportunities: many(opportunities),
}));

export const companyProfilesRelations = relations(companyProfiles, ({ many }) => ({
  certifications: many(certifications),
  opportunities: many(opportunities),
}));

export const certificationsRelations = relations(certifications, ({ one }) => ({
  companyProfile: one(companyProfiles, {
    fields: [certifications.companyProfileId],
    references: [companyProfiles.id],
  }),
}));

export const opportunitiesRelations = relations(opportunities, ({ one }) => ({
  tender: one(tenders, { fields: [opportunities.tenderId], references: [tenders.id] }),
  companyProfile: one(companyProfiles, {
    fields: [opportunities.companyProfileId],
    references: [companyProfiles.id],
  }),
}));
