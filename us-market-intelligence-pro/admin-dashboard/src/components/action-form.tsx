"use client";

import clsx from "clsx";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/lib/api";
import { buttonClass } from "./ui";

export type FormAction = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

function Submit({ label, variant, size, pendingLabel }: { label: ReactNode; variant: "primary" | "secondary" | "danger" | "ghost"; size: "sm" | "md"; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass(variant, size)}>
      {pending ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-e-transparent" aria-hidden /> : null}
      {pending && pendingLabel ? pendingLabel : label}
    </button>
  );
}

export function ResultMessage({ result, savedLabel, onClose }: { result: ActionResult | null; savedLabel: string; onClose?: () => void }) {
  if (!result) return null;
  return (
    <div
      role={result.ok ? "status" : "alert"}
      className={clsx(
        "flex items-start gap-2 rounded-lg px-3 py-2 text-xs",
        result.ok ? "bg-good-soft text-good-text" : "bg-critical-soft text-critical-text",
      )}
    >
      {result.ok ? <CheckCircle2 className="mt-px size-3.5 shrink-0" /> : <AlertTriangle className="mt-px size-3.5 shrink-0" />}
      <span className="min-w-0 flex-1 break-words">{result.ok ? (result.message ?? savedLabel) : result.error}</span>
      {onClose ? (
        <button type="button" onClick={onClose} className="shrink-0 opacity-70 hover:opacity-100" aria-label="close">
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/** A form bound to a Server Action, with pending state and an inline result. */
export function ActionForm({
  action, children, submitLabel, savedLabel, variant = "primary", size = "md", className, resetOnSuccess, footer,
}: {
  action: FormAction; children?: ReactNode; submitLabel: ReactNode; savedLabel: string;
  variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md"; className?: string;
  resetOnSuccess?: boolean; footer?: ReactNode;
}) {
  const [state, formAction] = useActionState(action, null);
  const [visible, setVisible] = useState(true);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={(fd) => { setVisible(true); return formAction(fd); }} className={clsx("flex flex-col gap-3", className)}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <Submit label={submitLabel} variant={variant} size={size} />
        {footer}
      </div>
      {visible ? <ResultMessage result={state} savedLabel={savedLabel} onClose={() => setVisible(false)} /> : null}
    </form>
  );
}

/**
 * Button that opens a modal confirmation. Optional typed phrase (for irreversible actions)
 * and optional reason textarea, both sent to the Server Action.
 */
export function ConfirmAction({
  action, trigger, title, body, confirmLabel, cancelLabel, savedLabel, phrase, phraseLabel,
  reasonLabel, hidden, variant = "danger", triggerVariant = "secondary", triggerSize = "sm",
}: {
  action: FormAction; trigger: ReactNode; title: string; body?: ReactNode; confirmLabel: string;
  cancelLabel: string; savedLabel: string; phrase?: string; phraseLabel?: string; reasonLabel?: string;
  hidden?: Record<string, string>; variant?: "primary" | "danger"; triggerVariant?: "primary" | "secondary" | "danger" | "ghost";
  triggerSize?: "sm" | "md";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [state, formAction] = useActionState(action, null);
  useEffect(() => {
    if (state?.ok) ref.current?.close();
  }, [state]);
  return (
    <>
      <button type="button" className={buttonClass(triggerVariant, triggerSize)} onClick={() => { setTyped(""); ref.current?.showModal(); }}>
        {trigger}
      </button>
      {state?.ok ? <ResultMessage result={state} savedLabel={savedLabel} /> : null}
      <dialog
        ref={ref}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-ink shadow-2xl"
        aria-labelledby="confirm-title"
      >
        <form action={formAction} className="flex flex-col gap-4 p-5">
          <h2 id="confirm-title" className="text-base font-semibold">{title}</h2>
          {body ? <div className="text-sm leading-relaxed text-ink-2">{body}</div> : null}
          {hidden ? Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />) : null}
          {reasonLabel ? (
            <label className="flex flex-col gap-1.5 text-xs font-medium text-ink-2">
              {reasonLabel}
              <textarea name="reason" required minLength={3} maxLength={300}
                className="min-h-20 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none" />
            </label>
          ) : null}
          {phrase ? (
            <label className="flex flex-col gap-1.5 text-xs font-medium text-ink-2">
              {phraseLabel}
              <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" dir="ltr"
                className="h-9 rounded-lg border border-line-strong bg-surface px-3 font-mono text-sm text-ink focus:border-accent focus:outline-none" />
            </label>
          ) : null}
          {state && !state.ok ? <ResultMessage result={state} savedLabel={savedLabel} /> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass("ghost", "md")} onClick={() => ref.current?.close()}>{cancelLabel}</button>
            <ConfirmSubmit label={confirmLabel} variant={variant} disabled={phrase !== undefined && typed.trim() !== phrase} />
          </div>
        </form>
      </dialog>
    </>
  );
}

function ConfirmSubmit({ label, variant, disabled }: { label: string; variant: "primary" | "danger"; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={disabled || pending} className={buttonClass(variant, "md")}>
      {pending ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-e-transparent" aria-hidden /> : null}
      {label}
    </button>
  );
}
