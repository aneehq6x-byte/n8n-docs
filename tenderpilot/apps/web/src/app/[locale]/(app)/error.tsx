"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-6" />
      </span>
      <h1 className="text-lg font-semibold">{t("errors.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("errors.description")}</p>
      {error.digest && <code className="ltr-nums text-xs text-muted-foreground">{error.digest}</code>}
      <Button onClick={reset} variant="outline">
        <RotateCw />
        {t("common.retry")}
      </Button>
    </div>
  );
}
