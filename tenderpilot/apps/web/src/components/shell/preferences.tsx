"use client";

import { Languages, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { signOut } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { usePathname, useRouter } from "@/i18n/navigation";

export function LocaleSwitcher() {
  const t = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const next = locale === "ar" ? "en" : "ar";
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={t("language")}
      onClick={() => {
        const qs = searchParams.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { locale: next });
      }}
    >
      <Languages />
      <span lang={next}>{t("switchTo")}</span>
    </Button>
  );
}

const THEME_ORDER = ["light", "dark", "system"] as const;

export function ThemeToggle() {
  const t = useTranslations("common");
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = mounted ? (THEME_ORDER.find((x) => x === theme) ?? "system") : "system";
  const Icon = current === "light" ? Sun : current === "dark" ? Moon : Monitor;
  const label = current === "light" ? t("themeLight") : current === "dark" ? t("themeDark") : t("themeSystem");
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`${t("theme")}: ${label}`}
      title={`${t("theme")}: ${label}`}
      onClick={() => setTheme(THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length] ?? "system")}
    >
      <Icon />
    </Button>
  );
}

export function SignOutButton() {
  const t = useTranslations("common");
  const locale = useLocale();
  return (
    <Button variant="ghost" size="sm" onClick={() => void signOut({ callbackUrl: `/${locale}/sign-in` })}>
      <LogOut className="rtl:-scale-x-100" />
      <span className="hidden sm:inline">{t("signOut")}</span>
    </Button>
  );
}
