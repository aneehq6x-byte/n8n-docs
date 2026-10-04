/**
 * Factor catalogue for the Opportunity scoring engine.
 *
 * Weights are explicit and sum to exactly 1.0, so the score is a clean weighted
 * average on a 0–100 scale. Changing strategy means editing this table only.
 */
export const FACTORS = {
  sector_match: { key: "sector_match", weight: 0.25, labelAr: "مطابقة القطاع", labelEn: "Sector match" },
  classification_eligibility: {
    key: "classification_eligibility",
    weight: 0.2,
    labelAr: "أهلية التصنيف",
    labelEn: "Classification eligibility",
  },
  certification_coverage: {
    key: "certification_coverage",
    weight: 0.2,
    labelAr: "تغطية الشهادات",
    labelEn: "Certification coverage",
  },
  value_fit: { key: "value_fit", weight: 0.15, labelAr: "ملاءمة القيمة", labelEn: "Value fit" },
  deadline_feasibility: {
    key: "deadline_feasibility",
    weight: 0.1,
    labelAr: "جدوى الموعد النهائي",
    labelEn: "Deadline feasibility",
  },
  past_performance: { key: "past_performance", weight: 0.1, labelAr: "سجل الأداء السابق", labelEn: "Past performance" },
} as const;

export type FactorKey = keyof typeof FACTORS;
export const FACTOR_KEYS = Object.keys(FACTORS) as FactorKey[];

/** Sum of all factor weights — asserted at module load to catch drift. */
export const TOTAL_WEIGHT = Object.values(FACTORS).reduce((sum, f) => sum + f.weight, 0);
if (Math.abs(TOTAL_WEIGHT - 1) > 1e-9) {
  throw new Error(`Factor weights must sum to 1, got ${TOTAL_WEIGHT}`);
}

/** Days needed to prepare a strong, competitive bid; at or beyond this, feasibility is full. */
export const COMFORTABLE_PREP_DAYS = 21;

/** Fractional days between two instants (negative if `to` is before `from`). */
export function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
}

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
