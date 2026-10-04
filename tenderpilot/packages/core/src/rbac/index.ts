import { z } from "zod";

/**
 * Role-based access control. The permission matrix lives in code (reviewed,
 * versioned, testable); the `roles` table mirrors it for display and for future
 * per-org custom roles.
 */
export const ROLES = ["owner", "admin", "analyst", "viewer"] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const PERMISSIONS = [
  "opportunity:read",
  "opportunity:update",
  "scout:run",
  "profile:manage",
  "org:manage",
  "audit:read",
] as const;
export const permissionSchema = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof permissionSchema>;

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: ["opportunity:read", "opportunity:update", "scout:run", "profile:manage", "audit:read"],
  analyst: ["opportunity:read", "opportunity:update", "scout:run"],
  viewer: ["opportunity:read"],
};

export const ROLE_LABELS: Record<Role, { ar: string; en: string }> = {
  owner: { ar: "المالك", en: "Owner" },
  admin: { ar: "مدير", en: "Admin" },
  analyst: { ar: "محلل مناقصات", en: "Tender analyst" },
  viewer: { ar: "مشاهد", en: "Viewer" },
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
