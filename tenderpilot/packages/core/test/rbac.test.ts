import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLES, assignableRoles, can, canManageRole } from "../src";

describe("rbac", () => {
  it("grants the owner every permission", () => {
    for (const p of PERMISSIONS) expect(can("owner", p)).toBe(true);
  });

  it("keeps viewers read-only", () => {
    expect(can("viewer", "opportunity:read")).toBe(true);
    expect(can("viewer", "opportunity:update")).toBe(false);
    expect(can("viewer", "scout:run")).toBe(false);
  });

  it("never lets a non-owner manage the org or billing", () => {
    for (const r of ROLES.filter((r) => r !== "owner")) {
      expect(can(r, "org:manage")).toBe(false);
      expect(can(r, "billing:manage")).toBe(false);
    }
  });

  it("only lets team managers assign roles below their own (owner may assign admin)", () => {
    expect(assignableRoles("owner")).toEqual(["admin", "analyst", "viewer"]);
    expect(assignableRoles("admin")).toEqual(["analyst", "viewer"]);
    expect(assignableRoles("analyst")).toEqual([]);
    expect(assignableRoles("viewer")).toEqual([]);
  });

  it("never allows granting or managing ownership through team management", () => {
    for (const r of ROLES) expect(canManageRole(r, "owner")).toBe(false);
  });

  it("stops admins from managing other admins", () => {
    expect(canManageRole("admin", "admin")).toBe(false);
    expect(canManageRole("owner", "admin")).toBe(true);
  });
});
