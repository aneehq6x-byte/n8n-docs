"use client";

import { Loader2 } from "lucide-react";
import { signIn } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/form";
import { useRouter } from "@/i18n/navigation";
import { signUpAction, type SignUpResult } from "./actions";

export function SignUpForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const [result, setResult] = useState<SignUpResult | undefined>();
  const [pending, startTransition] = useTransition();
  const invalid = (field: string) => (result && !result.ok && result.fields?.includes(field)) || undefined;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    startTransition(async () => {
      const res = await signUpAction({ name: form.get("name"), email, password, locale });
      setResult(res);
      if (!res.ok) return;
      const login = await signIn("credentials", { email, password, redirect: false });
      router.replace(login?.ok ? "/onboarding" : "/sign-in");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">{t("name")}</Label>
        <Input id="name" name="name" autoComplete="name" required aria-invalid={invalid("name")} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          dir="ltr"
          className="text-start"
          aria-invalid={invalid("email")}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          dir="ltr"
          aria-invalid={invalid("password")}
          aria-describedby="password-hint"
        />
        <p id="password-hint" className="text-xs text-muted-foreground">
          {t("passwordHint")}
        </p>
      </div>
      <FieldError message={result && !result.ok ? t(result.error) : undefined} />
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        {t("signUp")}
      </Button>
    </form>
  );
}
