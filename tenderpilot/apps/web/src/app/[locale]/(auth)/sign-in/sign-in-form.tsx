"use client";

import { Loader2 } from "lucide-react";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/form";
import { Link, useRouter } from "@/i18n/navigation";

/** `next` is validated on the server (safeNextPath) before it reaches this component. */
export function SignInForm({ next }: { next: string | null }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(undefined);
    startTransition(async () => {
      const res = await signIn("credentials", {
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
        redirect: false,
      });
      if (!res || res.error) {
        setError(res?.error === "RATE_LIMITED" ? t("rateLimited") : t("invalidCredentials"));
        return;
      }
      router.replace(next ?? "/dashboard");
      router.refresh();
    });
  }

  return (
    // method="post": if JS ever fails to load, a native submit must never put credentials in the URL.
    <form onSubmit={onSubmit} method="post" className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required dir="ltr" className="text-start" />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="password">{t("password")}</Label>
          <Link href="/forgot-password" className="text-xs text-primary hover:underline">
            {t("forgotLink")}
          </Link>
        </div>
        <Input id="password" name="password" type="password" autoComplete="current-password" required dir="ltr" />
      </div>
      <FieldError message={error} />
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        {t("signIn")}
      </Button>
    </form>
  );
}
