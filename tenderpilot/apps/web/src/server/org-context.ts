import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { getDb, getUserMemberships, type MembershipContext } from "@tenderpilot/db";
import { redirect } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { getSessionUser, type SessionUser } from "./auth";

export const ACTIVE_ORG_COOKIE = "tp_org";

/** Resolve the caller's active org: the cookie's org if they're a member, else their first org. */
export const resolveActiveMembership = cache(async (userId: string): Promise<MembershipContext | null> => {
  const memberships = await getUserMemberships(getDb(), userId);
  if (memberships.length === 0) return null;
  const preferred = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  return memberships.find((m) => m.orgId === preferred) ?? memberships[0] ?? null;
});

export async function requireUser(locale: AppLocale): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) return redirect({ href: "/sign-in", locale });
  return user;
}

export interface OrgContext {
  user: SessionUser;
  membership: MembershipContext;
}

/** Page guard: signed-in user with an org. Redirects to sign-in / onboarding otherwise. */
export async function requireOrgContext(locale: AppLocale): Promise<OrgContext> {
  const user = await requireUser(locale);
  const membership = await resolveActiveMembership(user.id);
  if (!membership) return redirect({ href: "/onboarding", locale });
  return { user, membership };
}
