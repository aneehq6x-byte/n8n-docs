import { redirect } from "@/i18n/navigation";
import { routing, type AppLocale } from "@/i18n/routing";
import { hasLocale } from "next-intl";

export default async function LocaleIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const resolved: AppLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  redirect({ href: "/dashboard", locale: resolved });
}
