"use client";

import { KeyRound, AlertTriangle } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { login, type LoginState } from "@/app/actions";
import { buttonClass } from "@/components/ui";

type Labels = { apiKey: string; apiKeyHint: string; submit: string; invalid: string; unreachable: string; required: string; expired: string };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass("primary", "md", "w-full")}>
      {pending ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-e-transparent" aria-hidden /> : null}
      {label}
    </button>
  );
}

export function LoginForm({ labels, expired }: { labels: Labels; expired: boolean }) {
  const [state, action] = useActionState<LoginState, FormData>(login, null);
  const error = state?.error ? labels[state.error] : expired ? labels.expired : null;
  return (
    <form action={action} className="flex flex-col gap-4">
      <label htmlFor="key" className="text-xs font-medium text-ink-2">{labels.apiKey}</label>
      <div className="relative -mt-2">
        <KeyRound className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          id="key" name="key" type="password" required autoComplete="current-password" dir="ltr" autoFocus
          className="h-10 w-full rounded-lg border border-line-strong bg-surface ps-9 pe-3 font-mono text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>
      <p className="-mt-2 text-xs text-muted">{labels.apiKeyHint}</p>
      {error ? (
        <p role="alert" className="flex items-center gap-2 rounded-lg bg-critical-soft px-3 py-2 text-xs text-critical-text">
          <AlertTriangle className="size-3.5 shrink-0" />{error}
        </p>
      ) : null}
      <Submit label={labels.submit} />
    </form>
  );
}
