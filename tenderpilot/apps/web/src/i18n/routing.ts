import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["ar", "en"],
  defaultLocale: "ar",
  localePrefix: "always",
  // Arabic-first product: entry is always Arabic, regardless of the browser's
  // Accept-Language. English is an explicit, URL-addressable choice.
  localeDetection: false,
});

export type AppLocale = (typeof routing.locales)[number];

export function directionOf(locale: AppLocale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}
