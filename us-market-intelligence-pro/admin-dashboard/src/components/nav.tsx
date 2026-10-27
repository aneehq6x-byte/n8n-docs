"use client";

import clsx from "clsx";
import {
  Activity, BarChart3, CreditCard, LayoutDashboard, ScrollText, Settings2, Tags, Users, Menu, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const ICONS = {
  overview: LayoutDashboard, signals: Activity, users: Users, payments: CreditCard, plans: Tags,
  performance: BarChart3, system: Settings2, audit: ScrollText,
} as const;

export type NavItem = { key: keyof typeof ICONS; href: string; label: string; badge?: number };
export type NavSection = { label: string; items: NavItem[] };

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function Links({ sections, onNavigate }: { sections: NavSection[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-5" aria-label="main">
      {sections.map((s) => (
        <div key={s.label}>
          <p className="mb-1.5 px-3 text-[0.6875rem] font-medium uppercase tracking-wide text-muted">{s.label}</p>
          <ul className="flex flex-col gap-0.5">
            {s.items.map((it) => {
              const Icon = ICONS[it.key];
              const on = isActive(pathname, it.href);
              return (
                <li key={it.key}>
                  <Link
                    href={it.href}
                    onClick={onNavigate}
                    aria-current={on ? "page" : undefined}
                    className={clsx(
                      "group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                      on ? "bg-accent-soft font-medium text-accent-text" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                    )}
                  >
                    <Icon className="size-4 shrink-0" strokeWidth={on ? 2.2 : 1.8} aria-hidden />
                    <span className="flex-1 truncate">{it.label}</span>
                    {it.badge ? (
                      <span className="rounded-full bg-accent px-1.5 text-[0.6875rem] font-semibold text-accent-ink tnum">{it.badge}</span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function SideNav({ sections }: { sections: NavSection[] }) {
  return <Links sections={sections} />;
}

export function MobileNav({ sections, brand, openLabel }: { sections: NavSection[]; brand: React.ReactNode; openLabel: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <div className="lg:hidden">
      <button type="button" onClick={() => setOpen(true)} aria-label={openLabel} aria-expanded={open}
        className="inline-flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2">
        <Menu className="size-5" />
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="close" onClick={() => setOpen(false)} />
          <div className="relative flex h-full w-72 max-w-[85vw] flex-col gap-6 overflow-y-auto border-e border-line bg-surface p-4">
            <div className="flex items-center justify-between">
              {brand}
              <button type="button" onClick={() => setOpen(false)} aria-label="close" className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2">
                <X className="size-4" />
              </button>
            </div>
            <Links sections={sections} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
