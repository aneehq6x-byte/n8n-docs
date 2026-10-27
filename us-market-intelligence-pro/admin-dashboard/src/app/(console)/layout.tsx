import { LogOut, ShieldCheck, AlertOctagon, FlaskConical } from "lucide-react";
import Link from "next/link";
import { logout } from "@/app/actions";
import { MobileNav, SideNav, type NavSection } from "@/components/nav";
import { PrefsBar } from "@/components/prefs";
import { Badge } from "@/components/ui";
import { api } from "@/lib/api";
import { getI18n, getTheme } from "@/lib/prefs";
import { hasRole } from "@/lib/roles";
import { requireRole } from "@/lib/guard";
import type { SystemInfo } from "@/lib/types";

async function systemStatus(): Promise<SystemInfo | null> {
  try {
    return await api<SystemInfo>("/admin/system");
  } catch {
    return null;
  }
}

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("support");
  const [{ locale, d }, theme] = await Promise.all([getI18n(), getTheme()]);
  const isAnalyst = hasRole(session.role, "analyst");
  const isAdmin = hasRole(session.role, "admin");
  const sys = await systemStatus();
  const pending = isAnalyst ? sys?.pending_review ?? 0 : 0;

  const sections: NavSection[] = [
    {
      label: d.nav.sections.operate,
      items: [
        { key: "overview" as const, href: "/", label: d.nav.overview },
        ...(isAnalyst ? [{ key: "signals" as const, href: "/signals", label: d.nav.signals, badge: pending || undefined }] : []),
        ...(isAnalyst ? [{ key: "performance" as const, href: "/performance", label: d.nav.performance }] : []),
      ],
    },
    {
      label: d.nav.sections.business,
      items: [
        { key: "users" as const, href: "/users", label: d.nav.users },
        ...(isAdmin ? [{ key: "payments" as const, href: "/payments", label: d.nav.payments }] : []),
        ...(isAdmin ? [{ key: "plans" as const, href: "/plans", label: d.nav.plans }] : []),
      ],
    },
    {
      label: d.nav.sections.control,
      items: [
        { key: "system" as const, href: "/system", label: d.nav.system },
        ...(isAdmin ? [{ key: "audit" as const, href: "/audit", label: d.nav.audit }] : []),
      ],
    },
  ];

  const brand = (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-ink"><ShieldCheck className="size-4" /></span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-ink">{d.brand.short}</span>
        <span className="block text-[0.6875rem] text-muted">{d.brand.console}</span>
      </span>
    </Link>
  );

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 overflow-y-auto border-e border-line bg-surface px-3 py-5 lg:flex">
        <div className="px-2">{brand}</div>
        <SideNav sections={sections} />
        <div className="mt-auto px-3 text-[0.6875rem] text-muted">
          {sys ? <span className="tnum">env: {sys.env} · data: {sys.market_data_provider}</span> : null}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur sm:px-6">
          <MobileNav sections={sections} brand={brand} openLabel="menu" />
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {sys?.kill_switch ? (
              <Link href="/system"><Badge tone="critical"><AlertOctagon className="size-3" />{d.system.killSwitch}</Badge></Link>
            ) : null}
            {sys?.market_data_provider === "mock" ? (
              <Badge tone="warning" className="hidden sm:inline-flex"><FlaskConical className="size-3" />MOCK DATA</Badge>
            ) : null}
          </div>
          <PrefsBar locale={locale} theme={theme} d={d} />
          <div className="hidden items-center gap-2 border-s border-line ps-3 sm:flex">
            <Badge tone="accent" dot={false}>{d.auth.role[session.role]}</Badge>
            <span className="max-w-32 truncate text-xs text-muted" dir="ltr" title={session.actor}>…{session.actor.slice(-4)}</span>
          </div>
          <form action={logout}>
            <button type="submit" title={d.auth.logout} aria-label={d.auth.logout}
              className="inline-flex size-8 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink">
              <LogOut className="size-4 rtl:-scale-x-100" />
            </button>
          </form>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
