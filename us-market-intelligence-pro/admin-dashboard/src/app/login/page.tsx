import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandName, Disclaimer, PrefsBar } from "@/components/prefs";
import { getI18n } from "@/lib/prefs";
import { getSession } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  if (await getSession()) redirect("/");
  const [{ locale, d }, sp] = await Promise.all([getI18n(), searchParams]);
  return (
    <main className="flex min-h-dvh flex-col">
      <div className="flex justify-end p-4"><PrefsBar locale={locale} d={d} /></div>
      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col gap-3">
            <BrandName console={d.brand.console} />
            <span className="rainr-rule-short" aria-hidden />
          </div>
          <div className="rounded-2xl border border-line bg-surface p-6">
            <h1 className="text-lg font-semibold text-ink">{d.auth.title}</h1>
            <p className="mb-6 mt-1 text-sm text-ink-2">{d.auth.subtitle}</p>
            <LoginForm
              expired={sp.expired === "1"}
              labels={{ apiKey: d.auth.apiKey, apiKeyHint: d.auth.apiKeyHint, submit: d.auth.submit, invalid: d.auth.invalid,
                unreachable: d.auth.unreachable, required: d.common.required, expired: d.auth.expired, rateLimited: d.auth.rateLimited }}
            />
          </div>
          <div className="mt-6"><Disclaimer /></div>
        </div>
      </div>
    </main>
  );
}
