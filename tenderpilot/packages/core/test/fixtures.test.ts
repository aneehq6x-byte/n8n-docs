import { describe, expect, it } from "vitest";
import {
  certificationSchema,
  companyProfileSchema,
  demoCertifications,
  demoCompanyProfile,
  etimadFixtures,
  rawTenderSchema,
} from "../src";

const REF = new Date("2026-06-26T00:00:00.000Z");

describe("seed fixtures", () => {
  it("every Etimad fixture satisfies the ingestion contract", () => {
    for (const t of etimadFixtures(REF)) expect(() => rawTenderSchema.parse(t)).not.toThrow();
  });

  it("source refs are unique", () => {
    const refs = etimadFixtures(REF).map((t) => t.sourceRef);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("dates are relative to the reference so the feed never goes stale", () => {
    const later = new Date("2027-03-01T00:00:00.000Z");
    for (const t of etimadFixtures(later)) {
      expect(new Date(t.publishedAt).getTime()).toBeLessThanOrEqual(later.getTime());
      expect(new Date(t.submissionDeadline).getTime()).toBeGreaterThan(later.getTime());
    }
  });

  it("demo profile and certifications are valid domain objects", () => {
    expect(() => companyProfileSchema.parse(demoCompanyProfile())).not.toThrow();
    for (const c of demoCertifications(REF)) expect(() => certificationSchema.parse(c)).not.toThrow();
  });

  it("contains both Arabic and English copy for every tender", () => {
    for (const t of etimadFixtures(REF)) {
      expect(t.titleAr).toMatch(/[؀-ۿ]/);
      expect(t.titleEn).toMatch(/[A-Za-z]/);
    }
  });
});
