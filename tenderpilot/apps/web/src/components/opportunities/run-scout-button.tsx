"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { CheckCircle2, Loader2, Radar } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { useTRPC } from "@/trpc/client";

type Phase = "idle" | "running" | "done" | "error";
const POLL_TIMEOUT_MS = 90_000;

/** Enqueue a Scout run, poll its status, then refresh the server-rendered data. */
export function RunScoutButton({ size, variant }: Pick<ButtonProps, "size" | "variant">) {
  const t = useTranslations("scout");
  const trpc = useTRPC();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const trigger = useMutation(
    trpc.scout.trigger.mutationOptions({
      onSuccess: () => {
        setPhase("running");
        setMessage(t("queued"));
        setStartedAt(Date.now());
      },
      onError: (err) => {
        setPhase("error");
        const code = err instanceof TRPCClientError ? (err.data as { code?: string } | undefined)?.code : undefined;
        setMessage(code === "FORBIDDEN" ? t("forbidden") : t("unavailable"));
      },
    }),
  );

  const status = useQuery({
    ...trpc.scout.status.queryOptions(),
    enabled: phase === "running",
    refetchInterval: phase === "running" ? 2_000 : false,
  });

  useEffect(() => {
    if (phase !== "running" || startedAt === null) return;
    const completed = status.data?.lastCompletedAt;
    if (completed && completed.getTime() >= startedAt - 1_000 && !status.data?.running) {
      // Scoring runs right after ingestion; give it a beat, then re-render server data.
      const timer = setTimeout(() => {
        setPhase("done");
        setMessage(t("done"));
        router.refresh();
      }, 1_500);
      return () => clearTimeout(timer);
    }
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      setPhase("error");
      setMessage(t("unavailable"));
    }
    return undefined;
  }, [phase, startedAt, status.data, router, t]);

  const busy = trigger.isPending || phase === "running";
  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <Button size={size} variant={variant} disabled={busy} onClick={() => trigger.mutate()}>
        {busy ? <Loader2 className="animate-spin" /> : <Radar />}
        {busy ? t("running") : t("run")}
      </Button>
      {message && (
        <p
          role="status"
          aria-live="polite"
          className={phase === "error" ? "text-xs text-destructive" : "flex items-center gap-1 text-xs text-muted-foreground"}
        >
          {phase === "done" && <CheckCircle2 className="size-3.5 text-success" />}
          {message}
        </p>
      )}
    </div>
  );
}
