import { describe, expect, it } from "vitest";
import {
  GenericGovConnector,
  MockEtimadConnector,
  collectTenders,
  dayOffset,
  deriveStatus,
  deterministicUuid,
  etimadFixtures,
  normalizeTender,
  scoutIngestedEventSchema,
  type RawTender,
  type TenderConnector,
} from "../src";

const REF = new Date("2026-06-26T00:00:00.000Z");
const clock = () => REF;
const SINCE = new Date("2000-01-01T00:00:00.000Z");
const FIXTURE_COUNT = etimadFixtures(REF).length;

describe("collectTenders", () => {
  it("collects and validates every fixture from the mock Etimad feed", async () => {
    const res = await collectTenders([new MockEtimadConnector({ clock })], SINCE);
    expect(res.tenders).toHaveLength(FIXTURE_COUNT);
    expect(res.fetchedPerSource).toEqual({ etimad: FIXTURE_COUNT });
    expect(res.failures).toEqual([]);
  });

  it("dedupes duplicate source refs within a batch and across connectors", async () => {
    const dupes = [...etimadFixtures(REF), ...etimadFixtures(REF)];
    const res = await collectTenders(
      [new MockEtimadConnector({ fixtures: dupes }), new MockEtimadConnector({ clock })],
      SINCE,
    );
    expect(res.tenders).toHaveLength(FIXTURE_COUNT);
  });

  it("respects the 'since' watermark", async () => {
    const since = dayOffset(REF, -2);
    const res = await collectTenders([new MockEtimadConnector({ clock })], since);
    // Only tenders published 1–2 days before the reference date.
    expect(res.tenders.map((t) => t.sourceRef).sort()).toEqual(["250612904431", "250645119963"]);
  });

  it("isolates a failing connector instead of aborting the sweep", async () => {
    const broken: TenderConnector = {
      source: "broken-portal",
      fetchTenders: () => Promise.reject(new Error("ECONNRESET")),
    };
    const res = await collectTenders([broken, new MockEtimadConnector({ clock })], SINCE);
    expect(res.tenders).toHaveLength(FIXTURE_COUNT);
    expect(res.failures).toEqual([{ source: "broken-portal", message: "ECONNRESET" }]);
  });

  it("rejects malformed fixtures at the connector boundary", async () => {
    const bad = { ...etimadFixtures(REF)[0], sector: "space_mining" } as unknown as RawTender;
    await expect(new MockEtimadConnector({ fixtures: [bad] }).fetchTenders(SINCE)).rejects.toThrow();
  });
});

describe("normalization", () => {
  it("derives a presentational status from the deadline", () => {
    expect(deriveStatus(dayOffset(REF, -6), REF)).toBe("closed");
    expect(deriveStatus(dayOffset(REF, 4), REF)).toBe("closing_soon");
    expect(deriveStatus(dayOffset(REF, 36), REF)).toBe("open");
  });

  it("produces a valid org-scoped Tender", () => {
    const [raw] = etimadFixtures(REF);
    if (!raw) throw new Error("no fixtures");
    const tender = normalizeTender(raw, {
      id: deterministicUuid("t1"),
      orgId: deterministicUuid("org"),
      entityId: deterministicUuid("entity"),
      asOf: REF,
    });
    expect(tender.title.ar).toBe(raw.titleAr);
    expect(tender.guarantee).toEqual({ bidBondPct: 0.02, performanceBondPct: 0.05 });
    expect(tender.status).toBe("open");
  });

  it("produces stable RFC-4122 v5 UUIDs", () => {
    expect(deterministicUuid("a")).toBe(deterministicUuid("a"));
    expect(deterministicUuid("a")).not.toBe(deterministicUuid("b"));
    expect(deterministicUuid("a")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("validates the ingested event contract", () => {
    expect(() =>
      scoutIngestedEventSchema.parse({
        type: "scout.tenders.ingested",
        orgId: deterministicUuid("org"),
        sources: ["etimad"],
        at: REF.toISOString(),
        createdTenderIds: [deterministicUuid("t1")],
        updatedTenderIds: [],
        failures: [],
      }),
    ).not.toThrow();
  });
});

describe("GenericGovConnector", () => {
  const record = { ref: "MOD-2026-118", title: "صيانة مبانٍ إدارية", value: 4_500_000 };
  const mapRecord = (input: unknown): RawTender => {
    const r = input as typeof record;
    return {
      sourceRef: r.ref,
      source: "mod_portal",
      entity: { nameAr: "وزارة الدفاع", nameEn: "Ministry of Defense", kind: "ministry", regionAr: null, regionEn: null },
      titleAr: r.title,
      titleEn: "Maintenance of administrative buildings",
      descriptionAr: "أعمال صيانة دورية لمبانٍ إدارية.",
      descriptionEn: "Routine maintenance of administrative buildings.",
      sector: "facilities_management",
      valueEstimate: r.value,
      requiredClassificationField: "operation_and_maintenance",
      requiredClassificationGrade: 4,
      requiredCertifications: ["iso_9001"],
      bidBondPct: 0.02,
      performanceBondPct: 0.05,
      publishedAt: REF.toISOString(),
      submissionDeadline: dayOffset(REF, 20, 11).toISOString(),
      rawDocumentRefs: [],
    };
  };

  it("fetches with bearer auth, maps and validates records", async () => {
    let seenAuth = "";
    const fetchImpl: typeof fetch = async (_url, init) => {
      seenAuth = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(JSON.stringify([record]), { status: 200, headers: { "content-type": "application/json" } });
    };
    const connector = new GenericGovConnector({
      source: "mod_portal",
      baseUrl: "https://portal.example.gov.sa",
      apiKey: "test-key",
      fetchImpl,
      mapRecord,
    });
    const raws = await connector.fetchTenders(SINCE);
    expect(seenAuth).toBe("Bearer test-key");
    expect(raws.map((r) => r.sourceRef)).toEqual(["MOD-2026-118"]);
  });

  it("throws on non-OK upstream responses", async () => {
    const connector = new GenericGovConnector({
      source: "broken",
      baseUrl: "https://broken.example.gov.sa",
      apiKey: "k",
      fetchImpl: async () => new Response("unavailable", { status: 503 }),
      mapRecord,
    });
    await expect(connector.fetchTenders(SINCE)).rejects.toThrow(/503/);
  });

  it("throws when the upstream body is not an array", async () => {
    const connector = new GenericGovConnector({
      source: "odd",
      baseUrl: "https://odd.example.gov.sa",
      apiKey: "k",
      fetchImpl: async () => new Response(JSON.stringify({ items: [] }), { status: 200 }),
      mapRecord,
    });
    await expect(connector.fetchTenders(SINCE)).rejects.toThrow(/array/);
  });
});
