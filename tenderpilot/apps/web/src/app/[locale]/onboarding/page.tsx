import { getTranslations, setRequestLocale } from "next-intl/server";
import AuthLayout from "../(auth)/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { redirect } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { requireUser, resolveActiveMembership } from "@/server/org-context";
import { OnboardingForm } from "./onboarding-form";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({ params }: { params: Promise<{ locale: AppLocale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  if (await resolveActiveMembership(user.id)) redirect({ href: "/dashboard", locale });
  const t = await getTranslations("onboarding");

  return (
    <AuthLayout>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{t("title")}</CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <OnboardingForm />
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
