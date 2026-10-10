import { AlertTriangle } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/misc";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { checkResetToken } from "../../forgot-password/actions";
import { ResetPasswordForm } from "./reset-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: AppLocale }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("resetTitle"), robots: { index: false } };
}

export default async function ResetPasswordPage({ params }: { params: Promise<{ locale: AppLocale; token: string }> }) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth");
  const valid = /^[A-Za-z0-9_-]{20,100}$/.test(token) && (await checkResetToken(token));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("resetTitle")}</CardTitle>
        {valid && <CardDescription>{t("resetSubtitle")}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {valid ? (
          <ResetPasswordForm token={token} />
        ) : (
          <>
            <Alert variant="destructive">
              <AlertTriangle />
              {t("resetInvalid")}
            </Alert>
            <Link href="/forgot-password" className={buttonVariants({ variant: "outline" })}>
              {t("requestNew")}
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}
