"use client";

import { CheckCircle2, AlertTriangle } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { createManualSignal } from "@/app/actions";
import { ResultMessage } from "@/components/action-form";
import { buttonClass, Field, Input, Select, Textarea } from "@/components/ui";
import type { Dict } from "@/lib/i18n";

type F = Dict["signals"]["form"];
type S = Dict["signals"];

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className={buttonClass("primary", "md")}>{label}</button>;
}

const MIN_RR = 1.5;

export function ManualSignalForm({ s, f, saved }: { s: S; f: F; saved: string }) {
  const [state, action] = useActionState(createManualSignal, null);
  const [v, setV] = useState({ direction: "long", entry_low: "", entry_high: "", stop: "", target1: "", target2: "" });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });

  const check = useMemo(() => {
    const n = (x: string) => (x === "" ? NaN : Number(x));
    const [el, eh, st, t1, t2] = [n(v.entry_low), n(v.entry_high), n(v.stop), n(v.target1), n(v.target2)];
    if ([el, eh, st, t1, t2].some(Number.isNaN)) return null;
    const long = v.direction === "long";
    const ok = el <= eh && (long ? st < el && eh < t1 && t1 <= t2 : st > eh && t2 <= t1 && t1 < el);
    const mid = (el + eh) / 2;
    const risk = Math.abs(mid - st);
    const rr = risk ? Math.abs(t1 - mid) / risk : 0;
    return { ok, rr };
  }, [v]);

  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label={s.symbol} htmlFor="symbol"><Input id="symbol" name="symbol" required maxLength={10} pattern="[A-Za-z.]+" dir="ltr" placeholder="SPY" className="uppercase" /></Field>
        <Field label={s.direction} htmlFor="direction">
          <Select id="direction" name="direction" value={v.direction} onChange={set("direction")}>
            <option value="long">{s.long}</option><option value="short">{s.short}</option>
          </Select>
        </Field>
        <Field label={f.kindLabel} htmlFor="kind">
          <Select id="kind" name="kind" defaultValue="paper">
            <option value="paper">{f.kindPaper}</option><option value="published">{f.kindPublished}</option>
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {([["entry_low", `${s.entry} ↓`], ["entry_high", `${s.entry} ↑`], ["stop", s.stop], ["target1", s.target1], ["target2", s.target2]] as const).map(([k, label]) => (
          <Field key={k} label={label} htmlFor={k}>
            <Input id={k} name={k} type="number" step="0.01" min="0.01" required dir="ltr" inputMode="decimal" value={v[k]} onChange={set(k)} />
          </Field>
        ))}
      </div>
      <div aria-live="polite" className="rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm">
        <p className="text-xs font-medium text-ink-2">{f.geometry}</p>
        {check === null ? <p className="mt-1 text-xs text-muted">{f.geometryHint}</p> : (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1">
            <span className={`inline-flex items-center gap-1.5 text-xs ${check.ok ? "text-good-text" : "text-critical-text"}`}>
              {check.ok ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
              {check.ok ? "OK" : f.geometryHint}
            </span>
            <span className={`text-xs ${check.rr >= MIN_RR ? "text-ink" : "text-critical-text"}`}>
              {f.rrPreview}: <strong className="tnum" dir="ltr">1:{check.rr.toFixed(2)}</strong> <span className="text-muted">({f.minRr})</span>
            </span>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label={f.validMinutes} htmlFor="valid_minutes"><Input id="valid_minutes" name="valid_minutes" type="number" min={5} max={7200} defaultValue={30} required dir="ltr" /></Field>
        <Field label={s.score} htmlFor="score"><Input id="score" name="score" type="number" min={0} max={100} defaultValue={60} required dir="ltr" /></Field>
        <Field label={s.invalidation} htmlFor="invalidation"><Input id="invalidation" name="invalidation" required minLength={3} maxLength={300} /></Field>
      </div>
      <Field label={s.reason} htmlFor="reason"><Textarea id="reason" name="reason" required minLength={10} maxLength={1000} rows={3} /></Field>
      <div className="flex items-center gap-3">
        <Submit label={f.submit} />
      </div>
      <ResultMessage result={state} savedLabel={saved} />
    </form>
  );
}
