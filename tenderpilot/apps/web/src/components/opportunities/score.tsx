import { Ban } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { scoreBand, type ScoreBand } from "@tenderpilot/core/scoring";
import { cn } from "@/lib/utils";

/** Score bands are status (good / caution / weak) — always paired with a text label, never colour alone. */
const BAND_TEXT: Record<ScoreBand, string> = {
  high: "text-success",
  medium: "text-warning",
  low: "text-muted-foreground",
};
const BAND_FILL: Record<ScoreBand, string> = {
  high: "bg-success",
  medium: "bg-warning",
  low: "bg-muted-foreground/60",
};
const BAND_TRACK: Record<ScoreBand, string> = {
  high: "bg-success/15",
  medium: "bg-warning/20",
  low: "bg-muted",
};
const BAND_STROKE: Record<ScoreBand, string> = {
  high: "stroke-success",
  medium: "stroke-warning",
  low: "stroke-muted-foreground/60",
};

/** Compact score cell: number + thin meter. Disqualified scores are flagged, not hidden. */
export function ScoreCell({ score, disqualified }: { score: number; disqualified: boolean }) {
  const format = useFormatter();
  const t = useTranslations("opportunity");
  const band = scoreBand(score);
  return (
    <div className="flex min-w-16 flex-col gap-1" title={disqualified ? t("disqualified") : t(`band.${band}`)}>
      <span className="flex items-center gap-1 text-sm font-semibold tabular-nums">
        {disqualified && <Ban aria-label={t("disqualified")} className="size-3.5 text-destructive" />}
        <span className={cn(disqualified ? "text-muted-foreground line-through decoration-destructive/60" : "")}>
          {format.number(score, "score")}
        </span>
      </span>
      <span className={cn("h-1.5 w-16 overflow-hidden rounded-full", disqualified ? "bg-muted" : BAND_TRACK[band])}>
        <span
          className={cn("block h-full rounded-full", disqualified ? "bg-destructive/50" : BAND_FILL[band])}
          style={{ width: `${score}%` }}
        />
      </span>
    </div>
  );
}

/** Large score ring for the detail page. */
export function ScoreRing({ score, disqualified }: { score: number; disqualified: boolean }) {
  const format = useFormatter();
  const t = useTranslations("opportunity");
  const band = scoreBand(score);
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-5">
      <div className="relative size-32 shrink-0">
        {/* Mirrored in RTL so the arc fills in reading direction. */}
        <svg viewBox="0 0 120 120" className="size-full -rotate-90 rtl:-scale-y-100" aria-hidden>
          <circle cx="60" cy="60" r={r} fill="none" strokeWidth="10" className="stroke-muted" />
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${(score / 100) * c} ${c}`}
            className={disqualified ? "stroke-destructive/60" : BAND_STROKE[band]}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-semibold">{format.number(score, "score")}</span>
          <span className="text-xs text-muted-foreground">{t("outOf")}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">{t("score")}</span>
        <span className={cn("text-lg font-semibold", disqualified ? "text-destructive" : BAND_TEXT[band])}>
          {disqualified ? t("disqualified") : t(`band.${band}`)}
        </span>
      </div>
    </div>
  );
}
