"use server";

import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";
import { TeamError, acceptInvitation, getDb } from "@tenderpilot/db";
import { redirect } from "@/i18n/navigation";
import { getSessionUser } from "@/server/auth";
import { ACTIVE_ORG_COOKIE } from "@/server/org-context";

export interface AcceptState {
  error?: string;
}

export async function acceptInviteAction(_prev: AcceptState, formData: FormData): Promise<AcceptState> {
  const locale = await getLocale();
  const token = String(formData.get("token") ?? "");
  const user = await getSessionUser();
  if (!user) return redirect({ href: { pathname: "/sign-in", query: { next: `/invite/${token}` } }, locale });

  let orgId: string;
  try {
    ({ orgId } = await acceptInvitation(getDb(), token, user));
  } catch (err) {
    if (err instanceof TeamError) return { error: err.code };
    console.error("accept invitation failed", err);
    return { error: "generic" };
  }
  // Land the new member directly in the org they just joined.
  (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return redirect({ href: "/dashboard", locale });
}
