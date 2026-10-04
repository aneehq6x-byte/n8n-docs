import type { AppLocale } from "@/i18n/routing";

/** Pick the locale's side of a bilingual { ar, en } value. */
export function localized(locale: AppLocale, value: { ar: string; en: string }): string {
  return locale === "ar" ? value.ar : value.en;
}

/** Pick between separate ar/en strings (e.g. DB columns). */
export function pick(locale: AppLocale, ar: string, en: string): string {
  return locale === "ar" ? ar : en;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days until the deadline; negative once passed. */
export function daysUntil(deadline: Date, now: Date): number {
  return Math.floor((deadline.getTime() - now.getTime()) / DAY_MS);
}
