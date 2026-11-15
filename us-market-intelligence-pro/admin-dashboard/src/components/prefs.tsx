import { Languages } from "lucide-react";
import { setLocale } from "@/app/actions";
import type { Dict, Locale } from "@/lib/i18n";

/** Works without client JS. The Rainr guide allows only the light cream style, so there is no theme switch. */
export function PrefsBar({ locale, d }: { locale: Locale; d: Dict }) {
  return (
    <form action={setLocale}>
      <input type="hidden" name="locale" value={locale === "ar" ? "en" : "ar"} />
      <button type="submit" title={d.prefs.language}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong px-2.5 text-xs font-medium text-ink-2 hover:bg-surface-3 hover:text-ink">
        <Languages className="size-3.5" aria-hidden />
        {locale === "ar" ? "English" : "العربية"}
      </button>
    </form>
  );
}

/** The documented short-form disclaimer, shown on every page exactly as approved. */
export function Disclaimer() {
  return <p className="text-xs text-ink-2">محتوى تعليمي وتحليلي فقط، وليس توصية.</p>;
}

/** Text name until the approved wordmark SVG is supplied (the wordmark is drawn paths, not a font). */
export function BrandName({ console: label }: { console: string }) {
  return (
    <span className="leading-tight">
      {/* Isolate only the word so its alignment follows the page direction. */}
      <span className="block font-heading text-lg text-ink"><bdi dir="ltr">Rainr</bdi></span>
      <span className="block text-[0.6875rem] text-ink-2">{label}</span>
    </span>
  );
}
