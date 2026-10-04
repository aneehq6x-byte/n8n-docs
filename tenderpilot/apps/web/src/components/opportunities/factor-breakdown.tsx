import { useFormatter, useLocale, useTranslations } from "next-intl";
import type { ScoreFactor } from "@tenderpilot/core/domain";
import { cn } from "@/lib/utils";

/**
 * The explainable score: one row per factor with its points, weight, a meter
 * (single hue, lighter track of the same hue, filled from the reading start),
 * and the plain-language reason. Every value is printed — nothing is hover-only.
 */
export function FactorBreakdown({ factors }: { factors: readonly ScoreFactor[] }) {
  const t = useTranslations("opportunity");
  const format = useFormatter();
  const locale = useLocale();
  return (
    <ol className="flex flex-col divide-y">
      {factors.map((f) => {
        const max = f.weight * 100;
        const full = f.ratio >= 0.999;
        const none = f.ratio <= 0.001;
        const label = locale === "ar" ? f.labelAr : f.labelEn;
        return (
          <li key={f.key} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="font-medium">{label}</span>
              <span className="flex items-baseline gap-3 text-sm">
                <span className="text-xs text-muted-foreground">
                  {t("weight", { weight: format.number(max, "plain") })}
                </span>
                <span className={cn("font-semibold tabular-nums", none && "text-destructive")}>
                  {t("contribution", { points: format.number(f.contribution, "plain"), max: format.number(max, "plain") })}
                </span>
              </span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-primary/15"
              role="meter"
              aria-label={label}
              aria-valuemin={0}
              aria-valuemax={max}
              aria-valuenow={f.contribution}
              title={`${label}: ${f.contribution} / ${max}`}
            >
              <div
                className={cn("h-full rounded-full", none ? "bg-transparent" : full ? "bg-primary" : "bg-primary/75")}
                style={{ width: `${f.ratio * 100}%` }}
              />
            </div>
            <p className="text-sm text-muted-foreground">{locale === "ar" ? f.reasonAr : f.reasonEn}</p>
          </li>
        );
      })}
    </ol>
  );
}
