import "server-only";
import { redirect } from "next/navigation";
import { getSession } from "./session";
import { hasRole, type Role } from "./roles";

/** Server-side role gate for pages. The backend enforces the same rule independently. */
export async function requireRole(min: Role) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!hasRole(s.role, min)) redirect("/?forbidden=1");
  return s;
}
