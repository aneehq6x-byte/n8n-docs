import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

function keyPaths(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => keyPaths(v, prefix ? `${prefix}.${k}` : k));
}

function placeholders(obj: unknown, prefix = ""): Record<string, string[]> {
  // Real ICU arguments look like `{name}` or `{count, plural, …}` — plural branch text does not.
  if (typeof obj === "string") {
    // Braces right after a plural/select selector (`=0 {…}`, `one {…}`) are branch bodies, not arguments.
    const args = /(?<!(?:=\d+|zero|one|two|few|many|other)\s*)\{(\w+)\s*[,}]/g;
    return { [prefix]: [...new Set([...obj.matchAll(args)].map((m) => m[1] ?? ""))].sort() };
  }
  if (typeof obj !== "object" || obj === null) return {};
  return Object.assign(
    {},
    ...Object.entries(obj).map(([k, v]) => placeholders(v, prefix ? `${prefix}.${k}` : k)),
  ) as Record<string, string[]>;
}

describe("i18n catalogs", () => {
  it("ar and en define exactly the same keys", () => {
    expect(keyPaths(ar).sort()).toEqual(keyPaths(en).sort());
  });

  it("ar and en use the same interpolation placeholders", () => {
    expect(placeholders(ar)).toEqual(placeholders(en));
  });
});
