import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@tenderpilot/jobs", () => ({ rateLimit: async () => ({ allowed: true, remaining: 1, retryAfterSeconds: 0 }) }));

const { clientIpFrom, safeNextPath } = await import("../src/server/security");

describe("safeNextPath", () => {
  it.each(["/ar/invite/abc_DEF-123", "/en/opportunities?sector=construction", "/dashboard"])("allows %s", (p) => {
    expect(safeNextPath(p)).toBe(p);
  });

  it.each([
    "//evil.com",
    "/\\evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "/ar/<script>",
    "",
    undefined,
    42,
  ])("rejects %s", (p) => {
    expect(safeNextPath(p)).toBeNull();
  });
});

describe("clientIpFrom", () => {
  it("takes the first X-Forwarded-For hop", () => {
    expect(clientIpFrom("203.0.113.7, 10.0.0.1")).toBe("203.0.113.7");
  });
  it("falls back for missing or oversized values", () => {
    expect(clientIpFrom(undefined)).toBe("unknown");
    expect(clientIpFrom("x".repeat(100))).toBe("unknown");
  });
});
