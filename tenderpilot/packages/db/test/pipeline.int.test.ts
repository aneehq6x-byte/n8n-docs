import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockEtimadConnector, demoCertifications, demoCompanyProfile, etimadFixtures } from "@tenderpilot/core";
import { createDb, type DbHandle } from "../src/client";
import { syncReferenceData } from "../src/reference-data";
import { certifications, opportunities, orgs, tenders, users } from "../src/schema";
import { upsertCertifications, upsertCompanyProfile } from "../src/services/company-profile";
import { createOrgWithOwner } from "../src/services/identity";
import { getCompanyProfileForm, saveCompanyProfile } from "../src/services/profile-editor";
import { rescoreOrg } from "../src/services/scoring";
import { runScoutForOrg } from "../src/services/scout";

/**
 * Integration tests against a real Postgres (skipped without DATABASE_URL).
 * Each run creates throwaway orgs — tenancy isolation doubles as test isolation.
 */
const url = process.env.DATABASE_URL;
const NOW = new Date();
const connectors = [new MockEtimadConnector({ clock: () => NOW })];
const FIXTURES = etimadFixtures(NOW).length;

describe.skipIf(!url)("scout → scoring pipeline (Postgres)", () => {
  let handle: DbHandle;
  const orgIds: string[] = [];
  let userId = "";

  async function newOrg(label: string, withCerts: boolean) {
    const template = demoCompanyProfile();
    const org = await handle.db.transaction((tx) =>
      createOrgWithOwner(tx, userId, {
        nameAr: `منشأة اختبار ${label}`,
        nameEn: `Test Org ${label}`,
        sectors: template.sectors,
        maxContractValue: template.maxContractValue,
      }),
    );
    orgIds.push(org.id);
    const profile = await upsertCompanyProfile(handle.db, org.id, {
      legalNameAr: template.legalName.ar,
      legalNameEn: template.legalName.en,
      sectors: template.sectors,
      classifications: template.classifications,
      annualTurnover: template.annualTurnover,
      maxContractValue: template.maxContractValue,
      pastProjects: template.pastProjects,
    });
    if (withCerts) {
      await upsertCertifications(
        handle.db,
        org.id,
        profile.id,
        demoCertifications(NOW).map(({ type, issuer, issuedAt, expiresAt }) => ({ type, issuer, issuedAt, expiresAt })),
      );
    }
    return { orgId: org.id, profileId: profile.id };
  }

  beforeAll(async () => {
    handle = createDb(url ?? "", { max: 2 });
    await syncReferenceData(handle.db);
    const [user] = await handle.db
      .insert(users)
      .values({ email: `it-${crypto.randomUUID()}@tenderpilot.test`, name: "Integration", passwordHash: "x" })
      .returning();
    userId = user?.id ?? "";
  });

  afterAll(async () => {
    for (const id of orgIds) await handle.db.delete(orgs).where(eq(orgs.id, id));
    if (userId) await handle.db.delete(users).where(eq(users.id, userId));
    await handle.close();
  });

  it("ingests idempotently: same tenders on re-run, created → updated", async () => {
    const { orgId } = await newOrg("A", true);
    const first = await runScoutForOrg(handle.db, orgId, { connectors, since: new Date(0), asOf: NOW });
    const second = await runScoutForOrg(handle.db, orgId, { connectors, since: new Date(0), asOf: NOW });
    expect(first.createdTenderIds).toHaveLength(FIXTURES);
    expect(second.createdTenderIds).toHaveLength(0);
    expect([...second.updatedTenderIds].sort()).toEqual([...first.createdTenderIds].sort());
    const count = await handle.db.$count(tenders, eq(tenders.orgId, orgId));
    expect(count).toBe(FIXTURES);
  });

  it("scores every tender, preserves workflow status on refresh, reacts to profile changes", async () => {
    const { orgId, profileId } = await newOrg("B", true);
    await runScoutForOrg(handle.db, orgId, { connectors, since: new Date(0), asOf: NOW });

    const result = await rescoreOrg(handle.db, orgId, { reason: "manual", asOf: NOW });
    expect(result.scored).toBe(FIXTURES);
    expect(result.disqualified).toBeGreaterThan(0);

    // A user moves one opportunity forward in the pipeline…
    const [target] = await handle.db.select().from(opportunities).where(eq(opportunities.orgId, orgId)).limit(1);
    if (!target) throw new Error("no opportunity");
    await handle.db.update(opportunities).set({ status: "pursuing" }).where(eq(opportunities.id, target.id));

    // …then the company loses a certification (profile change) and everything is re-scored.
    const before = await handle.db.select().from(opportunities).where(eq(opportunities.orgId, orgId));
    await handle.db
      .delete(certifications)
      .where(and(eq(certifications.companyProfileId, profileId), eq(certifications.type, "iso_9001")));
    await rescoreOrg(handle.db, orgId, { reason: "profile.changed", asOf: NOW });
    const after = await handle.db.select().from(opportunities).where(eq(opportunities.orgId, orgId));

    expect(after).toHaveLength(FIXTURES); // refreshed in place, no duplicates
    expect(after.find((o) => o.id === target.id)?.status).toBe("pursuing");
    const sum = (rows: typeof before) => rows.reduce((s, o) => s + o.score, 0);
    expect(sum(after)).toBeLessThan(sum(before));
  });

  it("keeps tenants isolated", async () => {
    const a = await newOrg("C", true);
    const b = await newOrg("D", false);
    await runScoutForOrg(handle.db, a.orgId, { connectors, since: new Date(0), asOf: NOW });
    await rescoreOrg(handle.db, a.orgId, { reason: "manual", asOf: NOW });
    expect(await handle.db.$count(tenders, eq(tenders.orgId, b.orgId))).toBe(0);
    expect(await handle.db.$count(opportunities, eq(opportunities.orgId, b.orgId))).toBe(0);
  });

  it("saves the profile editor document and reports the re-scoring impact", async () => {
    const { orgId } = await newOrg("E", true);
    await runScoutForOrg(handle.db, orgId, { connectors, since: new Date(0), asOf: NOW });
    await rescoreOrg(handle.db, orgId, { reason: "manual", asOf: NOW });

    const form = await getCompanyProfileForm(handle.db, orgId);
    if (!form) throw new Error("no profile form");
    expect(form.certifications).toHaveLength(5);

    // Gain the SFDA license (King Saud Hospital O&M needs it) → that opportunity improves.
    const gained = await saveCompanyProfile(
      handle.db,
      orgId,
      { ...form, certifications: [...form.certifications, { type: "sfda_license", issuer: "SFDA", issuedAt: "2026-01-01", expiresAt: null }] },
      userId,
    );
    expect(gained.improved).toBeGreaterThanOrEqual(1);
    expect(gained.declined).toBe(0);

    // Drop the "buildings" classification → building tenders become ineligible.
    const dropped = await saveCompanyProfile(
      handle.db,
      orgId,
      { ...form, classifications: form.classifications.filter((c) => c.field !== "buildings") },
      userId,
    );
    expect(dropped.newlyDisqualified).toBeGreaterThanOrEqual(3);
    expect(dropped.averageAfter ?? 0).toBeLessThan(dropped.averageBefore ?? 0);

    // The editor round-trips: SFDA was removed again by the second save (full replace).
    const after = await getCompanyProfileForm(handle.db, orgId);
    expect(after?.certifications.map((c) => c.type)).not.toContain("sfda_license");
  });

  it("rejects an invalid profile document without writing anything", async () => {
    const { orgId } = await newOrg("F", true);
    const before = await getCompanyProfileForm(handle.db, orgId);
    await expect(saveCompanyProfile(handle.db, orgId, { ...before, sectors: [] }, userId)).rejects.toThrow();
    expect(await getCompanyProfileForm(handle.db, orgId)).toEqual(before);
  });

  it("skips scoring for an org without a profile", async () => {
    const [org] = await handle.db
      .insert(orgs)
      .values({ slug: `no-profile-${crypto.randomUUID().slice(0, 8)}`, nameAr: "بدون ملف", nameEn: "No profile" })
      .returning();
    if (!org) throw new Error("org insert failed");
    orgIds.push(org.id);
    expect((await rescoreOrg(handle.db, org.id, { reason: "manual" })).skippedReason).toBe("no_profile");
  });
});
