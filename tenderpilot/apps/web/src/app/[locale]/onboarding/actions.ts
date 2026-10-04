"use server";

import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";
import { createOrgInputSchema, createOrgWithOwner, getDb, getUserMemberships } from "@tenderpilot/db";
import { redirect } from "@/i18n/navigation";
import { getSessionUser } from "@/server/auth";
import { ACTIVE_ORG_COOKIE } from "@/server/org-context";

export interface OnboardingState {
  error?: "invalidInput" | "genericError";
  fields?: string[];
}

export async function createOrgAction(_prev: OnboardingState, formData: FormData): Promise<OnboardingState> {
  const locale = await getLocale();
  const user = await getSessionUser();
  if (!user) return redirect({ href: "/sign-in", locale });

  const parsed = createOrgInputSchema.safeParse({
    nameAr: formData.get("nameAr"),
    nameEn: formData.get("nameEn"),
    crNumber: formData.get("crNumber") ?? "",
    sectors: formData.getAll("sectors"),
    maxContractValue: formData.get("maxContractValue"),
  });
  if (!parsed.success) {
    return { error: "invalidInput", fields: parsed.error.issues.map((i) => String(i.path[0])) };
  }

  const db = getDb();
  // One workspace per user during onboarding: re-submits land on the existing org.
  const existing = await getUserMemberships(db, user.id);
  const orgId = existing[0]?.orgId ?? (await db.transaction((tx) => createOrgWithOwner(tx, user.id, parsed.data))).id;

  (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return redirect({ href: "/dashboard", locale });
}
