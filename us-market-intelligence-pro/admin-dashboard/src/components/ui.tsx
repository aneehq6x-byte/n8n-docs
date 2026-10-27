import clsx from "clsx";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/* ----------------------------------------------------------------- layout */

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[1.375rem] font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-ink-2">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ className, children, ...rest }: ComponentProps<"section">) {
  return (
    <section
      className={clsx("rounded-xl border border-line bg-surface shadow-card", className)}
      {...rest}
    >
      {children}
    </section>
  );
}

export function CardHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-[0.9375rem] font-semibold text-ink">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
      </div>
      {actions}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx("px-5 py-4", className)}>{children}</div>;
}

/* ---------------------------------------------------------------- buttons */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover border-transparent",
  secondary: "bg-surface text-ink border-line-strong hover:bg-surface-2",
  ghost: "bg-transparent text-ink-2 border-transparent hover:bg-surface-2 hover:text-ink",
  danger: "bg-critical text-white border-transparent hover:opacity-90",
};
const SIZES: Record<Size, string> = { sm: "h-8 px-3 text-xs gap-1.5", md: "h-9 px-4 text-sm gap-2" };

export function buttonClass(variant: Variant = "secondary", size: Size = "md", className?: string) {
  return clsx(
    "inline-flex shrink-0 items-center justify-center rounded-lg border font-medium transition-colors",
    "disabled:cursor-not-allowed disabled:opacity-50",
    VARIANTS[variant], SIZES[size], className,
  );
}

export function Button({ variant, size, className, ...rest }: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...rest} />;
}

export function LinkButton({ variant, size, className, ...rest }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

/* ----------------------------------------------------------------- badges */

export type Tone = "neutral" | "accent" | "good" | "warning" | "serious" | "critical";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2",
  accent: "bg-accent-soft text-accent-text",
  good: "bg-good-soft text-good-text",
  warning: "bg-warning-soft text-warning-text",
  serious: "bg-serious-soft text-serious-text",
  critical: "bg-critical-soft text-critical-text",
};

const DOTS: Record<Tone, string> = {
  neutral: "bg-muted", accent: "bg-accent", good: "bg-good", warning: "bg-warning",
  serious: "bg-serious", critical: "bg-critical",
};

/** Status is always label + dot, never colour alone. */
export function Badge({ tone = "neutral", children, dot = true, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", TONES[tone], className)}>
      {dot ? <span aria-hidden className={clsx("size-1.5 rounded-full", DOTS[tone])} /> : null}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ forms */

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-ink-2">{label}</label>
      {children}
      {error ? <p className="text-xs text-critical-text">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

const control =
  "h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-muted " +
  "transition-colors hover:border-ink-2/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={clsx(control, className)} {...rest} />;
}

export function Select({ className, ...rest }: ComponentProps<"select">) {
  return <select className={clsx(control, "pe-8", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea className={clsx(control, "h-auto min-h-20 py-2 leading-relaxed", className)} {...rest} />;
}

/* ------------------------------------------------------------------ table */

export function Table({ children, caption }: { children: ReactNode; caption?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function Th({ className, ...rest }: ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={clsx("whitespace-nowrap border-b border-line bg-surface px-4 py-2.5 text-start text-xs font-medium text-muted", className)}
      {...rest}
    />
  );
}

export function Td({ className, ...rest }: ComponentProps<"td">) {
  return <td className={clsx("border-b border-line px-4 py-3 align-middle text-ink", className)} {...rest} />;
}

export function Tr({ className, ...rest }: ComponentProps<"tr">) {
  return <tr className={clsx("transition-colors hover:bg-surface-2/60", className)} {...rest} />;
}

/* -------------------------------------------------------------- feedback */

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon ? <div className="mb-1 text-muted">{icon}</div> : null}
      <p className="text-sm font-medium text-ink">{title}</p>
      {children ? <div className="max-w-md text-sm text-ink-2">{children}</div> : null}
    </div>
  );
}

export function Notice({ tone = "accent", icon, children, className }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div role={tone === "critical" ? "alert" : "status"} className={clsx("flex items-start gap-3 rounded-lg px-4 py-3 text-sm", TONES[tone], className)}>
      {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------- figures */

export function StatTile({ label, value, hint, delta, href }: {
  label: string; value: ReactNode; hint?: ReactNode;
  delta?: { text: string; tone: Tone }; href?: string;
}) {
  const inner = (
    <>
      <p className="text-xs font-medium text-ink-2">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-ink">{value}</p>
      <div className="mt-1.5 flex min-h-5 items-center gap-2 text-xs text-muted">
        {delta ? <Badge tone={delta.tone} dot={false}>{delta.text}</Badge> : null}
        {hint}
      </div>
    </>
  );
  const cls = "block rounded-xl border border-line bg-surface p-4 shadow-card";
  return href ? <Link href={href} className={clsx(cls, "transition-colors hover:border-line-strong")}>{inner}</Link> : <div className={cls}>{inner}</div>;
}

export function KeyValue({ items }: { items: { k: string; v: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.k} className="min-w-0">
          <dt className="text-xs text-muted">{it.k}</dt>
          <dd className="mt-0.5 break-words text-sm text-ink">{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tabs({ items, active }: { items: { key: string; label: ReactNode; href: string; count?: number }[]; active: string }) {
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-line" aria-label="tabs">
      {items.map((it) => {
        const on = it.key === active;
        return (
          <Link
            key={it.key}
            href={it.href}
            aria-current={on ? "page" : undefined}
            className={clsx(
              "-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors",
              on ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink",
            )}
          >
            {it.label}
            {it.count !== undefined ? (
              <span className={clsx("rounded-full px-1.5 text-[0.6875rem] tnum", on ? "bg-accent-soft text-accent-text" : "bg-surface-2 text-muted")}>
                {it.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function Pagination({ total, limit, offset, hrefFor, labels }: {
  total: number; limit: number; offset: number; hrefFor: (offset: number) => string;
  labels: { previous: string; next: string; showing: string; of: string };
}) {
  if (total <= limit) return null;
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-xs text-ink-2">
      <span className="tnum">{labels.showing} {from}–{to} {labels.of} {total}</span>
      <div className="flex gap-2">
        {offset > 0 ? <LinkButton size="sm" href={hrefFor(Math.max(0, offset - limit))}>{labels.previous}</LinkButton> : null}
        {to < total ? <LinkButton size="sm" href={hrefFor(offset + limit)}>{labels.next}</LinkButton> : null}
      </div>
    </div>
  );
}
