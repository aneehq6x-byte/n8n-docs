import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PrefsBar } from "@/components/prefs";
import { getI18n, getTheme } from "@/lib/prefs";
import { getSession } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  if (await getSession()) redirect("/");
  const [{ locale, d }, theme, sp] = await Promise.all([getI18n(), getTheme(), searchParams]);
  return (
    <main className="flex min-h-dvh flex-col">
      <div className="flex justify-end p-4"><PrefsBar locale={locale} theme={theme} d={d} /></div>
      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-ink"><ShieldCheck className="size-5" /></div>
            <div>
              <p className="text-sm font-semibold text-ink">{d.brand.name}</p>
              <p className="text-xs text-muted">{d.brand.console}</p>
            </div>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-6 shadow-card">
            <h1 className="text-lg font-semibold text-ink">{d.auth.title}</h1>
            <p className="mb-6 mt-1 text-sm text-ink-2">{d.auth.subtitle}</p>
            <LoginForm
              expired={sp.expired === "1"}
              labels={{ apiKey: d.auth.apiKey, apiKeyHint: d.auth.apiKeyHint, submit: d.auth.submit, invalid: d.auth.invalid,
                unreachable: d.auth.unreachable, required: d.common.required, expired: d.auth.expired }}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
