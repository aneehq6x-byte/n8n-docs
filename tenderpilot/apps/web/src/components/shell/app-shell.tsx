import type { ReactNode } from "react";
import { Suspense } from "react";
import { Link } from "@/i18n/navigation";
import { Logo } from "./logo";
import { NavLinks } from "./nav-links";
import { OrgSwitcher } from "./org-switcher";
import { LocaleSwitcher, SignOutButton, ThemeToggle } from "./preferences";

export function AppShell({
  orgName,
  userName,
  orgs,
  activeOrgId,
  banner,
  children,
}: {
  orgName: string;
  userName: string;
  orgs: { id: string; name: string }[];
  activeOrgId: string;
  banner?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 border-e bg-card p-4 md:flex">
        <Link href="/dashboard" className="px-1">
          <Logo />
        </Link>
        <NavLinks />
        <div className="mt-auto flex flex-col gap-2 rounded-lg bg-muted/60 p-3 text-xs">
          {orgs.length > 1 ? <OrgSwitcher orgs={orgs} activeOrgId={activeOrgId} /> : <p className="truncate font-medium">{orgName}</p>}
          <p className="truncate text-muted-foreground">{userName}</p>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
          <div className="flex h-14 items-center gap-2 px-4 md:px-6">
            <Link href="/dashboard" className="md:hidden">
              <Logo />
            </Link>
            <p className="hidden truncate text-sm text-muted-foreground md:block">{orgName}</p>
            <div className="ms-auto flex items-center gap-1">
              <Suspense>
                <LocaleSwitcher />
              </Suspense>
              <ThemeToggle />
              <SignOutButton />
            </div>
          </div>
          <div className="border-t px-2 py-1 md:hidden">
            <NavLinks orientation="horizontal" />
          </div>
        </header>
        {banner}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-6">{children}</main>
      </div>
    </div>
  );
}
