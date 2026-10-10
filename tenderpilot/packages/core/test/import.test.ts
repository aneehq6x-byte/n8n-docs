import { describe, expect, it } from "vitest";
import { CsvImportConnector, importTemplateCsv, parseCsv, parseTenderImport } from "../src";

const NOW = new Date("2026-10-10T09:00:00.000Z");
const HEADER = "source_ref,title_ar,issuer_ar,sector,deadline";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, embedded newlines, CRLF and BOM", () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n"multi\nline",z\r\n\r\n');
    expect(rows).toEqual([
      ["a", "b"],
      ["x, y", 'he said "hi"'],
      ["multi\nline", "z"],
    ]);
  });

  it("detects semicolon-delimited exports (Excel, Arabic locale)", () => {
    expect(parseCsv("a;b\n1;2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseTenderImport", () => {
  it("imports the bundled template cleanly (both rows, defaults applied)", () => {
    const r = parseTenderImport(importTemplateCsv(), NOW);
    expect(r.errors).toEqual([]);
    expect(r.tenders).toHaveLength(2);
    const [a, b] = r.tenders;
    expect(a).toMatchObject({ source: "etimad", sector: "facilities_management", valueEstimate: 14_500_000, bidBondPct: 0.02 });
    expect(a?.requiredClassificationField).toBe("operation_and_maintenance");
    expect(a?.requiredCertifications).toEqual(["iso_9001", "saudization_nitaqat"]);
    // Arabic labels, DD/MM/YYYY and blank optional cells
    expect(b).toMatchObject({ source: "manual", sector: "construction", valueEstimate: null, requiredClassificationGrade: 3 });
    expect(b?.titleEn).toBe(b?.titleAr);
    expect(b?.requiredCertifications).toEqual(["iso_9001"]);
    // 20/12/2026 end of day, Riyadh time (UTC+3) → 20:59 UTC
    expect(b?.submissionDeadline).toBe("2026-12-20T20:59:00.000Z");
  });

  it("accepts Arabic headers and Arabic-Indic digits", () => {
    const csv = "الرقم المرجعي,اسم المنافسة,الجهة,القطاع,آخر موعد لتقديم العروض,القيمة التقديرية\n٢٥٠٧٠٣,ترميم مبنى,أمانة الشرقية,construction,١٥/١٢/٢٠٢٦,\"١٬٢٥٠٬٠٠٠\"";
    const r = parseTenderImport(csv, NOW);
    expect(r.errors).toEqual([]);
    expect(r.tenders[0]).toMatchObject({ sourceRef: "250703", valueEstimate: 1_250_000 });
  });

  it("reports each bad cell with line and column, keeping the valid rows", () => {
    const csv = [
      HEADER + ",value_sar,classification,certifications",
      "R1,عنوان,جهة,construction,2026-12-01,1000,buildings:3,iso_9001",
      "R2,عنوان,جهة,space_mining,2026-13-40,abc,buildings:9,iso_99999",
      "R1,عنوان,جهة,construction,2026-12-01,,,",
      ",,جهة,construction,2026-12-01,,,",
    ].join("\n");
    const r = parseTenderImport(csv, NOW);
    expect(r.tenders.map((t) => t.sourceRef)).toEqual(["R1"]);
    const codes = r.errors.map((e) => `${e.line}:${e.column}:${e.code}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        "3:sector:INVALID_SECTOR",
        "3:deadline:INVALID_DATE",
        "3:value_sar:INVALID_NUMBER",
        "3:classification:INVALID_CLASSIFICATION",
        "3:certifications:INVALID_CERTIFICATION",
        "4:source_ref:DUPLICATE_REF",
        "5:source_ref:REQUIRED",
        "5:title_ar:REQUIRED",
      ]),
    );
  });

  it("rejects impossible dates and deadlines before publication", () => {
    const r = parseTenderImport(`${HEADER},published_at\nR1,ع,ج,construction,31/02/2027,\nR2,ع,ج,construction,2026-10-01,2026-10-05`, NOW);
    expect(r.errors.map((e) => e.code)).toEqual(["INVALID_DATE", "DEADLINE_BEFORE_PUBLISH"]);
  });

  it("names missing required columns", () => {
    const r = parseTenderImport("source_ref,title_ar\nR1,x", NOW);
    expect(r.fileError).toBe("MISSING_COLUMNS");
    expect(r.missingColumns).toEqual(["issuer_ar", "sector", "deadline"]);
  });

  it("enforces size and row limits", () => {
    expect(parseTenderImport(`${HEADER}\n${"R,ع,ج,construction,2026-12-01\n".repeat(1001)}`, NOW).fileError).toBe("TOO_MANY_ROWS");
    expect(parseTenderImport("x".repeat(2 * 1024 * 1024 + 1), NOW).fileError).toBe("FILE_TOO_LARGE");
    expect(parseTenderImport(HEADER, NOW).fileError).toBe("EMPTY");
  });

  it("feeds rows into the Scout pipeline through a connector", async () => {
    const { tenders } = parseTenderImport(importTemplateCsv(), NOW);
    expect(await new CsvImportConnector(tenders).fetchTenders()).toHaveLength(2);
  });
});
