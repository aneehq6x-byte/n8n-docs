import { describe, expect, it } from "vitest";
import { companyProfileFormSchema, type CompanyProfileForm } from "../src";

const valid: CompanyProfileForm = {
  legalNameAr: "شركة البنيان المتقدمة للمقاولات",
  legalNameEn: "Al-Bunyan Advanced Contracting Co.",
  sectors: ["construction"],
  annualTurnover: 120_000_000,
  maxContractValue: 60_000_000,
  classifications: [{ field: "buildings", grade: 3 }],
  certifications: [{ type: "iso_9001", issuer: "Bureau Veritas", issuedAt: "2025-01-01", expiresAt: "2028-01-01" }],
  pastProjects: [
    { titleAr: "مجمع مدارس", titleEn: "School complex", sector: "construction", value: 1_000_000, performancePct: 90, year: 2024 },
  ],
};

const codes = (input: unknown) => {
  const r = companyProfileFormSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("companyProfileFormSchema", () => {
  it("accepts a valid profile", () => {
    expect(companyProfileFormSchema.safeParse(valid).success).toBe(true);
  });

  it("requires at least one sector", () => {
    expect(companyProfileFormSchema.safeParse({ ...valid, sectors: [] }).success).toBe(false);
  });

  it("rejects duplicate classification fields and certifications", () => {
    expect(codes({ ...valid, classifications: [...valid.classifications, { field: "buildings", grade: 2 }] })).toContain("DUPLICATE_FIELD");
    expect(codes({ ...valid, certifications: [...valid.certifications, ...valid.certifications] })).toContain("DUPLICATE_CERTIFICATION");
  });

  it("rejects an expiry on or before the issue date, but allows no expiry", () => {
    const bad = [{ ...valid.certifications[0], expiresAt: "2024-12-31" }];
    expect(codes({ ...valid, certifications: bad })).toContain("EXPIRY_BEFORE_ISSUE");
    expect(companyProfileFormSchema.safeParse({ ...valid, certifications: [{ ...valid.certifications[0], expiresAt: null }] }).success).toBe(true);
  });

  it("flags an unrealistic contract capacity relative to turnover", () => {
    expect(codes({ ...valid, maxContractValue: 700_000_000 })).toContain("CAPACITY_UNREALISTIC");
  });

  it("rejects NaN from half-typed numeric inputs and out-of-range grades", () => {
    expect(companyProfileFormSchema.safeParse({ ...valid, annualTurnover: Number.NaN }).success).toBe(false);
    expect(companyProfileFormSchema.safeParse({ ...valid, classifications: [{ field: "roads", grade: 6 }] }).success).toBe(false);
  });
});
