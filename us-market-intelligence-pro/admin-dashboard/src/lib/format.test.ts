import { describe, expect, it } from "vitest";
import { fmtDual, fmtNumber, fmtPct, fmtR, relativeFromNow } from "./format";
import { DICTS } from "./i18n";
import { hasRole, isRole } from "./roles";

describe("formatting", () => {
  it("uses Latin digits in Arabic for financial clarity", () => {
    expect(fmtNumber(1234.5, "ar")).toBe("1,234.5");
    expect(fmtPct(0.742, "en")).toBe("74.2%");
    expect(fmtR(-1.05, "en")).toBe("-1.05R");
    expect(fmtR(2, "en")).toBe("+2.00R");
    expect(fmtNumber(null, "en")).toBe("—");
  });

  it("shows New York time with the DST-correct label next to Riyadh", () => {
    const winter = fmtDual("2026-01-13T15:05:00Z", "en");
    const summer = fmtDual("2026-03-10T14:05:00Z", "en");
    expect(winter.ny).toMatch(/10:05 EST$/);
    expect(winter.ry).toMatch(/18:05$/);
    expect(summer.ny).toMatch(/10:05 EDT$/);
    expect(summer.ry).toMatch(/17:05$/);
  });

  it("treats offset-less backend timestamps as UTC", () => {
    expect(fmtDual("2026-03-10T14:05:00", "en").ny).toMatch(/10:05 EDT$/);
  });

  it("formats relative time", () => {
    const now = new Date("2026-03-10T12:00:00Z");
    expect(relativeFromNow("2026-03-10T15:00:00Z", "en", now)).toBe("in 3 hours");
  });
});

describe("roles", () => {
  it("ranks support < analyst < admin", () => {
    expect(hasRole("admin", "analyst")).toBe(true);
    expect(hasRole("analyst", "admin")).toBe(false);
    expect(hasRole(undefined, "support")).toBe(false);
    expect(isRole("root")).toBe(false);
  });
});

describe("dictionaries", () => {
  function keys(o: object, prefix = ""): string[] {
    return Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [prefix + k] : keys(v, `${prefix}${k}.`)));
  }
  it("English provides every Arabic key, with no empty strings", () => {
    expect(keys(DICTS.en).sort()).toEqual(keys(DICTS.ar).sort());
    for (const l of ["ar", "en"] as const) {
      const empty = keys(DICTS[l]).filter((k) => !k.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], DICTS[l]));
      expect(empty).toEqual([]);
    }
  });
});
