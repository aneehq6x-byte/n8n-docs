"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";

/** Error boundaries cannot read server cookies, so the message is shown in both languages. */
export default function ConsoleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl border border-line bg-surface p-6 text-center">
      <AlertTriangle className="mx-auto size-8 text-serious-text" strokeWidth={1.5} />
      <h1 className="mt-3 text-base font-semibold text-ink">تعذّر تحميل هذه الصفحة</h1>
      <p className="text-sm text-ink-2" dir="ltr">This page could not be loaded.</p>
      <p className="mt-3 text-xs text-muted">لم يتم تنفيذ أي تغيير · No changes were made.</p>
      {error.digest ? <p className="mt-2 font-mono text-[0.6875rem] text-muted" dir="ltr">ref: {error.digest}</p> : null}
      <button type="button" onClick={reset}
        className="mt-5 inline-flex h-9 items-center rounded-lg border border-line-strong px-4 text-sm font-medium text-ink hover:bg-surface-2">
        إعادة المحاولة · Retry
      </button>
    </div>
  );
}
