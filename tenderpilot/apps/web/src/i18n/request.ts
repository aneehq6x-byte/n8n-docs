import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const messages = (await import(`../../messages/${locale}.json`)) as { default: IntlMessages };
  return {
    locale,
    messages: messages.default,
    timeZone: "Asia/Riyadh",
    // Gregorian calendar + Latin digits: matches Etimad and keeps dense tables scannable.
    formats: {
      number: {
        sar: { style: "currency", currency: "SAR", maximumFractionDigits: 0, numberingSystem: "latn" },
        compact: { notation: "compact", maximumFractionDigits: 1, numberingSystem: "latn" },
        plain: { maximumFractionDigits: 1, numberingSystem: "latn" },
      },
      dateTime: {
        short: { day: "numeric", month: "short", year: "numeric", calendar: "gregory", numberingSystem: "latn" },
        long: {
          day: "numeric",
          month: "long",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          calendar: "gregory",
          numberingSystem: "latn",
        },
      },
    },
  };
});

type IntlMessages = typeof import("../../messages/en.json");
