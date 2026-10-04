"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/form";
import { createOrgAction, type OnboardingState } from "./actions";

export function OnboardingForm() {
  const t = useTranslations("onboarding");
  const tAuth = useTranslations("auth");
  const [state, action, pending] = useActionState<OnboardingState, FormData>(createOrgAction, {});
  const invalid = (f: string) => state.fields?.includes(f) || undefined;

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="nameAr">{t("nameAr")}</Label>
        <Input id="nameAr" name="nameAr" dir="rtl" lang="ar" required aria-invalid={invalid("nameAr")} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="nameEn">{t("nameEn")}</Label>
        <Input id="nameEn" name="nameEn" dir="ltr" lang="en" required aria-invalid={invalid("nameEn")} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="crNumber">{t("crNumber")}</Label>
        <Input
          id="crNumber"
          name="crNumber"
          inputMode="numeric"
          dir="ltr"
          maxLength={10}
          aria-invalid={invalid("crNumber")}
          aria-describedby="cr-hint"
        />
        <p id="cr-hint" className="text-xs text-muted-foreground">
          {t("crHint")}
        </p>
      </div>
      <FieldError
        message={state.error === "invalidInput" ? t("invalidInput") : state.error ? tAuth("genericError") : undefined}
      />
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        {t("submit")}
      </Button>
    </form>
  );
}
