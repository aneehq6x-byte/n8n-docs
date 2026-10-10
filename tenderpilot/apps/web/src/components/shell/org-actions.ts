"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { getDb, getUserMemberships } from "@tenderpilot/db";
import { getSessionUser } from "@/server/auth";
import { ACTIVE_ORG_COOKIE } from "@/server/org-context";

/** Switch the active org — only to an org the caller is actually a member of. */
export async function setActiveOrgAction(orgId: string): Promise<boolean> {
  const parsed = z.uuid().safeParse(orgId);
  const user = await getSessionUser();
  if (!parsed.success || !user) return false;
  const memberships = await getUserMemberships(getDb(), user.id);
  if (!memberships.some((m) => m.orgId === parsed.data)) return false;
  (await cookies()).set(ACTIVE_ORG_COOKIE, parsed.data, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return true;
}
