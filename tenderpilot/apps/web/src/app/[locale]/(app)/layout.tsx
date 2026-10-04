import { setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import type { AppLocale } from "@/i18n/routing";
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
  const orgName = locale === "ar" ? membership.org.nameAr : membership.org.nameEn;
  return (
    <AppShell orgName={orgName} userName={user.name}>
      {children}
    </AppShell>
  );
}
