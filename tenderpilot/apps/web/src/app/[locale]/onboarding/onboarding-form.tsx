"use client";

import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";
import { SECTORS, SECTOR_LABELS } from "@tenderpilot/core";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/form";
import { createOrgAction, type OnboardingState } from "./actions";

export function OnboardingForm() {
  const t = useTranslations("onboarding");
  const tAuth = useTranslations("auth");
  const locale = useLocale();
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
      <fieldset className="flex flex-col gap-2" aria-invalid={invalid("sectors")} aria-describedby="sectors-hint">
        <legend className="mb-2 text-sm font-medium">{t("sectors")}</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SECTORS.map((s) => (
            <label
              key={s}
              className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm has-checked:border-primary has-checked:bg-primary/8"
            >
              <input type="checkbox" name="sectors" value={s} className="size-4 accent-[var(--primary)]" />
              {SECTOR_LABELS[s][locale]}
            </label>
          ))}
        </div>
        <p id="sectors-hint" className={invalid("sectors") ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          {t("sectorsHint")}
        </p>
      </fieldset>
      <div className="flex flex-col gap-2">
        <Label htmlFor="maxContractValue">{t("maxContractValue")}</Label>
        <Input
          id="maxContractValue"
          name="maxContractValue"
          type="number"
          inputMode="numeric"
          min={100000}
          step={100000}
          dir="ltr"
          required
          placeholder="25000000"
          aria-invalid={invalid("maxContractValue")}
          aria-describedby="mcv-hint"
        />
        <p id="mcv-hint" className="text-xs text-muted-foreground">
          {t("maxContractValueHint")}
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
