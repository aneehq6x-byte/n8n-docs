import { getTranslations, setRequestLocale } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { getServerCaller } from "@/trpc/server";

export default async function DashboardPage({ params }: { params: Promise<{ locale: AppLocale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("dashboard");
  const me = await (await getServerCaller()).me();
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-muted-foreground">{t("welcome", { name: me.user.name })}</p>
    </div>
  );
}
