import type { Locale } from "./i18n";

const NUM_LOCALE: Record<Locale, string> = { ar: "ar-SA-u-nu-latn", en: "en-US" };

export function fmtNumber(n: number | null | undefined, locale: Locale, opts: Intl.NumberFormatOptions = {}): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat(NUM_LOCALE[locale], opts).format(n);
}

export function fmtCompact(n: number | null | undefined, locale: Locale): string {
  if (n === null || n === undefined) return "—";
  return Math.abs(n) < 10_000
    ? fmtNumber(n, locale, { maximumFractionDigits: 1 })
    : fmtNumber(n, locale, { notation: "compact", maximumFractionDigits: 1 });
}

export function fmtPct(n: number | null | undefined, locale: Locale, digits = 1): string {
  return fmtNumber(n, locale, { style: "percent", maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function fmtR(n: number | null | undefined, locale: Locale): string {
  if (n === null || n === undefined) return "—";
  return `${fmtNumber(n, locale, { maximumFractionDigits: 2, minimumFractionDigits: 2, signDisplay: "exceptZero" })}R`;
}

export function fmtPrice(n: number | null | undefined, locale: Locale): string {
  return fmtNumber(n, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parse(d: string | Date): Date {
  if (d instanceof Date) return d;
  // Backend timestamps without an offset are UTC.
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(d) ? d : `${d}Z`);
}

export function fmtDateTime(d: string | Date | null | undefined, locale: Locale, timeZone = "Asia/Riyadh"): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat(NUM_LOCALE[locale], {
    timeZone, year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(parse(d));
}

export function fmtDate(d: string | Date | null | undefined, locale: Locale, timeZone = "Asia/Riyadh"): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat(NUM_LOCALE[locale], { timeZone, year: "numeric", month: "short", day: "2-digit" }).format(parse(d));
}

/** "10:05 ET · 17:05 الرياض" — New York label follows DST automatically. */
export function fmtDual(d: string | Date | null | undefined, locale: Locale): { ny: string; ry: string } {
  if (!d) return { ny: "—", ry: "—" };
  const date = parse(d);
  const time = (tz: string) =>
    new Intl.DateTimeFormat(NUM_LOCALE[locale], { timeZone: tz, month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  const nyAbbr = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "short" })
    .formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? "ET";
  return { ny: `${time("America/New_York")} ${nyAbbr}`, ry: time("Asia/Riyadh") };
}

export function relativeFromNow(d: string | Date | null | undefined, locale: Locale, now = new Date()): string {
  if (!d) return "—";
  const diff = (parse(d).getTime() - now.getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale === "ar" ? "ar" : "en", { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}
