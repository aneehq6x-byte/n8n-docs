import { AlertTriangle, Users } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import AuthLayout from "../../(auth)/layout";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/misc";
import { getDb, getInvitationByToken } from "@tenderpilot/db";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { pick } from "@/lib/i18n-utils";
import { getSessionUser } from "@/server/auth";
import { AcceptInviteForm, SwitchAccountButton } from "./accept-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: AppLocale }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "invite" });
  return { title: t("accept"), robots: { index: false } };
}

export default async function InvitePage({ params }: { params: Promise<{ locale: AppLocale; token: string }> }) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const [t, tRoles] = await Promise.all([getTranslations("invite"), getTranslations("enums.role")]);
  const invite = /^[A-Za-z0-9_-]{20,100}$/.test(token) ? await getInvitationByToken(getDb(), token) : null;
  const user = await getSessionUser();
  const next = `/invite/${token}`;

  let body;
  if (!invite || invite.status !== "valid") {
    const key = !invite || invite.status === "valid" ? "notFound" : invite.status;
    body = (
      <Alert variant="destructive">
        <AlertTriangle />
        {t(key)}
      </Alert>
    );
  } else if (!user) {
    body = (
      <div className="flex flex-col gap-2">
        <Link href={{ pathname: "/sign-in", query: { next } }} className={buttonVariants()}>
          {t("signInToAccept")}
        </Link>
        <Link href={{ pathname: "/sign-up", query: { next } }} className={buttonVariants({ variant: "outline" })}>
          {t("signUpToAccept")}
        </Link>
      </div>
    );
  } else if (user.email.toLowerCase() !== invite.email) {
    body = (
      <div className="flex flex-col gap-3">
        <Alert variant="warning">
          <AlertTriangle />
          <span>{t("mismatch", { current: user.email, email: invite.email })}</span>
        </Alert>
        <SwitchAccountButton token={token} />
      </div>
    );
  } else {
    body = <AcceptInviteForm token={token} />;
  }

  return (
    <AuthLayout>
      <Card>
        <CardHeader>
          <span className="mb-1 grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
            <Users className="size-5" />
          </span>
          <CardTitle className="text-xl">
            {invite ? t("title", { org: pick(locale, invite.org.nameAr, invite.org.nameEn) }) : t("notFound")}
          </CardTitle>
          {invite?.status === "valid" && (
            <CardDescription>{t("subtitle", { email: invite.email, role: tRoles(invite.role) })}</CardDescription>
          )}
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>
    </AuthLayout>
  );
}
