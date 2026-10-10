import { Lock } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { TeamManager } from "@/components/team/team-manager";
import { Alert } from "@/components/ui/misc";
import type { AppLocale } from "@/i18n/routing";
import { getServerCaller } from "@/trpc/server";

export async function generateMetadata({ params }: { params: Promise<{ locale: AppLocale }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "team" });
  return { title: t("title") };
}

export default async function TeamPage({ params }: { params: Promise<{ locale: AppLocale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, caller] = await Promise.all([getTranslations("team"), getServerCaller()]);
  const overview = await caller.team.overview();
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>
      {!overview.canManage && (
        <Alert>
          <Lock />
          {t("readOnly")}
        </Alert>
      )}
      <TeamManager overview={overview} />
    </div>
  );
}
