"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { forgotPasswordAction, type ForgotState } from "./actions";

export function ForgotPasswordForm() {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState<ForgotState, FormData>(forgotPasswordAction, { status: "idle" });

  if (state.status === "sent") {
    return (
      <Alert>
        <CheckCircle2 className="text-success" />
        <span role="status">{t("forgotSent")}</span>
      </Alert>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required dir="ltr" className="text-start" />
      </div>
      <FieldError message={state.status === "rateLimited" ? t("rateLimited") : undefined} />
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        {t("sendLink")}
      </Button>
    </form>
  );
}
