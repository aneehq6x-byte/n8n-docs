import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLES, can } from "../src";

describe("rbac", () => {
  it("grants the owner every permission", () => {
    for (const p of PERMISSIONS) expect(can("owner", p)).toBe(true);
  });

  it("keeps viewers read-only", () => {
    expect(can("viewer", "opportunity:read")).toBe(true);
    expect(can("viewer", "opportunity:update")).toBe(false);
    expect(can("viewer", "scout:run")).toBe(false);
  });

  it("never lets a non-owner manage the org", () => {
    for (const r of ROLES.filter((r) => r !== "owner")) expect(can(r, "org:manage")).toBe(false);
  });
});
