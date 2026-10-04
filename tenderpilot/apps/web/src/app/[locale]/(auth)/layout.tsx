import type { ReactNode } from "react";
import { Suspense } from "react";
import { Logo } from "@/components/shell/logo";
import { LocaleSwitcher, ThemeToggle } from "@/components/shell/preferences";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-primary/8 to-background">
      <header className="flex items-center justify-between px-4 py-4 md:px-8">
        <Logo />
        <div className="flex items-center gap-1">
          <Suspense>
            <LocaleSwitcher />
          </Suspense>
          <ThemeToggle />
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 md:items-center md:pt-0">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
