import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { safeNextPath } from "@/server/security";
import { SignInForm } from "./sign-in-form";

export async function generateMetadata({ params }: { params: Promise<{ locale: AppLocale }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("signIn") };
}

export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: AppLocale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const next = safeNextPath((await searchParams).next);
  const t = await getTranslations("auth");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("signInTitle")}</CardTitle>
        <CardDescription>{t("signInSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <SignInForm next={next} />
        <p className="text-center text-sm text-muted-foreground">
          {t("noAccount")}{" "}
          <Link href={next ? { pathname: "/sign-up", query: { next } } : "/sign-up"} className="font-medium text-primary hover:underline">
            {t("signUp")}
          </Link>
        </p>
        {!next && <p className="rounded-md bg-muted px-3 py-2 text-center text-xs text-muted-foreground">{t("demoHint")}</p>}
      </CardContent>
    </Card>
  );
}
