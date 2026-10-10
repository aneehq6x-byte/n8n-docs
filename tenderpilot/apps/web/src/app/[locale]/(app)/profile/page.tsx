import { Lock } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { can } from "@tenderpilot/core";
import { ProfileEditor } from "@/components/profile/profile-editor";
import { Alert } from "@/components/ui/misc";
import type { AppLocale } from "@/i18n/routing";
import { getServerCaller } from "@/trpc/server";

export async function generateMetadata({ params }: { params: Promise<{ locale: AppLocale }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "profile" });
  return { title: t("title") };
}

export default async function ProfilePage({ params }: { params: Promise<{ locale: AppLocale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, caller] = await Promise.all([getTranslations("profile"), getServerCaller()]);
  const [me, profile] = await Promise.all([caller.me(), caller.profile.get()]);
  const canEdit = can(me.role, "profile:manage");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>
      {!canEdit && (
        <Alert>
          <Lock />
          {t("readOnly")}
        </Alert>
      )}
      <ProfileEditor initial={profile} canEdit={canEdit} />
    </div>
  );
}
