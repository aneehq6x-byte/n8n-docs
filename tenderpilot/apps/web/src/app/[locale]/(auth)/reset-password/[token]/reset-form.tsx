"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { Link } from "@/i18n/navigation";
import { resetPasswordAction, type ResetState } from "../../forgot-password/actions";

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState<ResetState, FormData>(resetPasswordAction, { status: "idle" });

  if (state.status === "done") {
    return (
      <div className="flex flex-col gap-4">
        <Alert>
          <CheckCircle2 className="text-success" />
          <span role="status">{t("resetDone")}</span>
        </Alert>
        <Link href="/sign-in" className={buttonVariants()}>
          {t("signIn")}
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{t("newPassword")}</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required dir="ltr" />
      </div>
      <FieldError message={state.status === "weak" ? t("passwordHint") : state.status === "invalid" ? t("resetInvalid") : undefined} />
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        {t("resetSubmit")}
      </Button>
    </form>
  );
}
