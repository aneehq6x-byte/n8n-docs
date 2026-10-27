import clsx from "clsx";
import { Languages, Monitor, Moon, Sun } from "lucide-react";
import { setLocale, setTheme } from "@/app/actions";
import type { Dict, Locale } from "@/lib/i18n";
import type { Theme } from "@/lib/prefs";

/** Works without client JS: each control is a tiny form posting to a Server Action. */
export function PrefsBar({ locale, theme, d }: { locale: Locale; theme: Theme; d: Dict }) {
  const themes: { v: Theme; icon: typeof Sun; label: string }[] = [
    { v: "light", icon: Sun, label: d.prefs.light },
    { v: "dark", icon: Moon, label: d.prefs.dark },
    { v: "system", icon: Monitor, label: d.prefs.system },
  ];
  return (
    <div className="flex items-center gap-2">
      <form action={setLocale}>
        <input type="hidden" name="locale" value={locale === "ar" ? "en" : "ar"} />
        <button type="submit" title={d.prefs.language}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-medium text-ink-2 hover:bg-surface-2 hover:text-ink">
          <Languages className="size-3.5" aria-hidden />
          {locale === "ar" ? "English" : "العربية"}
        </button>
      </form>
      <div role="group" aria-label={d.prefs.theme} className="flex h-8 items-center rounded-lg border border-line p-0.5">
        {themes.map(({ v, icon: Icon, label }) => (
          <form key={v} action={setTheme}>
            <input type="hidden" name="theme" value={v} />
            <button type="submit" title={label} aria-label={label} aria-pressed={theme === v}
              className={clsx("inline-flex size-7 items-center justify-center rounded-md transition-colors",
                theme === v ? "bg-surface-3 text-ink" : "text-muted hover:text-ink")}>
              <Icon className="size-3.5" aria-hidden />
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
