export type Role = "support" | "analyst" | "admin";

const RANK: Record<Role, number> = { support: 1, analyst: 2, admin: 3 };

export function hasRole(role: Role | undefined, min: Role): boolean {
  return role !== undefined && RANK[role] >= RANK[min];
}

export function isRole(v: unknown): v is Role {
  return v === "support" || v === "analyst" || v === "admin";
}
