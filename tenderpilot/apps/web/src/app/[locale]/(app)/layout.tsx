import { setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { getDb, getOrgEntitlements, getUserMemberships } from "@tenderpilot/db";
import { AppShell } from "@/components/shell/app-shell";
import { SubscriptionBanner } from "@/components/shell/subscription-banner";
import type { AppLocale } from "@/i18n/routing";
import { pick } from "@/lib/i18n-utils";
import { requireOrgContext } from "@/server/org-context";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = (await params).locale as AppLocale;
  setRequestLocale(locale);
  const { user, membership } = await requireOrgContext(locale);
  const [memberships, entitlements] = await Promise.all([
    getUserMemberships(getDb(), user.id),
    getOrgEntitlements(getDb(), membership.orgId),
  ]);
  return (
    <AppShell
      orgName={pick(locale, membership.org.nameAr, membership.org.nameEn)}
      userName={user.name}
      orgs={memberships.map((m) => ({ id: m.orgId, name: pick(locale, m.org.nameAr, m.org.nameEn) }))}
      activeOrgId={membership.orgId}
      banner={<SubscriptionBanner entitlements={entitlements} />}
    >
      {children}
    </AppShell>
  );
}
