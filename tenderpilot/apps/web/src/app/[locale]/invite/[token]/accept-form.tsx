"use client";

import { Loader2, LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/form";
import { acceptInviteAction, type AcceptState } from "./actions";

export function AcceptInviteForm({ token }: { token: string }) {
  const t = useTranslations("invite");
  const [state, action, pending] = useActionState<AcceptState, FormData>(acceptInviteAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <FieldError message={state.error ? t("error") : undefined} />
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        {t("accept")}
      </Button>
    </form>
  );
}

export function SwitchAccountButton({ token }: { token: string }) {
  const t = useTranslations("invite");
  const locale = useLocale();
  return (
    <Button
      variant="outline"
      onClick={() => void signOut({ callbackUrl: `/${locale}/sign-in?next=${encodeURIComponent(`/invite/${token}`)}` })}
    >
      <LogOut className="rtl:-scale-x-100" />
      {t("switchAccount")}
    </Button>
  );
}
