import { CERTIFICATION_LABELS, CLASSIFICATION_FIELD_LABELS, SECTOR_LABELS } from "../domain/enums";
import type { Certification, CompanyProfile, ScoreBreakdown, ScoreFactor, Tender } from "../domain/models";
import { COMFORTABLE_PREP_DAYS, FACTORS, FACTOR_KEYS, clamp01, daysBetween, type FactorKey } from "./factors";

export interface ScoringInput {
  tender: Tender;
  profile: CompanyProfile;
  /** Certifications held by the profile (validity is checked against the deadline). */
  certifications: readonly Certification[];
  /** Evaluation instant — injected for determinism; the engine never reads the clock. */
  asOf: Date;
}

interface FactorResult {
  ratio: number;
  reasonAr: string;
  reasonEn: string;
  /** Set when this factor is a hard eligibility gate that failed. */
  gate?: { reasonAr: string; reasonEn: string };
}

const fmtSar = (n: number) => `${Math.round(n / 1_000_000).toLocaleString("en-US")}M`;

function sectorMatch({ tender, profile }: ScoringInput): FactorResult {
  const sector = SECTOR_LABELS[tender.sector];
  return profile.sectors.includes(tender.sector)
    ? { ratio: 1, reasonAr: `قطاع «${sector.ar}» ضمن تخصصات الشركة`, reasonEn: `“${sector.en}” is one of the company's sectors` }
    : {
        ratio: 0,
        reasonAr: `قطاع «${sector.ar}» خارج تخصصات الشركة المسجّلة`,
        reasonEn: `“${sector.en}” is outside the company's registered sectors`,
      };
}

function classificationEligibility({ tender, profile }: ScoringInput): FactorResult {
  const field = tender.requiredClassificationField;
  const required = tender.requiredClassificationGrade;
  if (field === null || required === null) {
    return { ratio: 1, reasonAr: "لا تشترط المنافسة تصنيفًا محددًا", reasonEn: "No contractor classification required" };
  }
  const label = CLASSIFICATION_FIELD_LABELS[field];
  const held = profile.classifications.find((c) => c.field === field);
  if (!held) {
    return {
      ratio: 0,
      reasonAr: `الشركة غير مصنّفة في مجال «${label.ar}» (المطلوب: الدرجة ${required})`,
      reasonEn: `Company is not classified in “${label.en}” (grade ${required} required)`,
      gate: { reasonAr: `غير مؤهل: لا يوجد تصنيف في مجال «${label.ar}»`, reasonEn: `Ineligible: no “${label.en}” classification` },
    };
  }
  // Grade 1 is the strongest; the company must hold the required grade or better.
  if (held.grade <= required) {
    return {
      ratio: 1,
      reasonAr: `مصنّفة في «${label.ar}» بالدرجة ${held.grade} (المطلوب ${required} أو أعلى)`,
      reasonEn: `Classified in “${label.en}” at grade ${held.grade} (grade ${required} or better required)`,
    };
  }
  return {
    ratio: 0,
    reasonAr: `درجة التصنيف ${held.grade} في «${label.ar}» أقل من المطلوب (${required})`,
    reasonEn: `Grade ${held.grade} in “${label.en}” is below the required grade ${required}`,
    gate: {
      reasonAr: `غير مؤهل: درجة التصنيف في «${label.ar}» أقل من المطلوب`,
      reasonEn: `Ineligible: “${label.en}” classification grade below requirement`,
    },
  };
}

function certificationCoverage({ tender, certifications }: ScoringInput): FactorResult {
  const required = tender.requiredCertifications;
  if (required.length === 0) {
    return { ratio: 1, reasonAr: "لا توجد شهادات مطلوبة", reasonEn: "No certifications required" };
  }
  // A certification only counts if it stays valid through the submission deadline.
  const validHeld = new Set(
    certifications.filter((c) => c.expiresAt === null || c.expiresAt >= tender.submissionDeadline).map((c) => c.type),
  );
  const missing = required.filter((t) => !validHeld.has(t));
  const ratio = (required.length - missing.length) / required.length;
  if (missing.length === 0) {
    return {
      ratio,
      reasonAr: `جميع الشهادات المطلوبة (${required.length}) متوفرة وسارية حتى الموعد النهائي`,
      reasonEn: `All ${required.length} required certifications held and valid through the deadline`,
    };
  }
  return {
    ratio,
    reasonAr: `ينقص ${missing.length} من ${required.length}: ${missing.map((t) => CERTIFICATION_LABELS[t].ar).join("، ")}`,
    reasonEn: `Missing ${missing.length} of ${required.length}: ${missing.map((t) => CERTIFICATION_LABELS[t].en).join(", ")}`,
  };
}

function valueFit({ tender, profile }: ScoringInput): FactorResult {
  const value = tender.valueEstimate;
  if (value === null) {
    return { ratio: 0.6, reasonAr: "القيمة التقديرية غير معلنة", reasonEn: "Estimated value not disclosed" };
  }
  const r = value / profile.maxContractValue;
  const pair = `${fmtSar(value)} / ${fmtSar(profile.maxContractValue)} SAR`;
  if (r > 1) {
    // Above the comfortable ceiling: decays linearly to 0 at 2× capacity.
    return {
      ratio: clamp01(1 - (r - 1)),
      reasonAr: `القيمة تتجاوز السقف المريح للشركة (${pair})`,
      reasonEn: `Value exceeds the company's comfortable ceiling (${pair})`,
    };
  }
  if (r < 0.2) {
    // Small contracts remain fine, just slightly less attractive.
    return {
      ratio: clamp01(0.6 + (r / 0.2) * 0.4),
      reasonAr: `عقد صغير نسبيًا مقارنة بقدرة الشركة (${pair})`,
      reasonEn: `Relatively small for the company's capacity (${pair})`,
    };
  }
  return {
    ratio: 1,
    reasonAr: `القيمة ضمن النطاق المثالي لقدرة الشركة (${pair})`,
    reasonEn: `Value sits in the company's ideal capacity range (${pair})`,
  };
}

function deadlineFeasibility({ tender, asOf }: ScoringInput): FactorResult {
  const days = daysBetween(asOf, tender.submissionDeadline);
  if (days <= 0) return { ratio: 0, reasonAr: "انتهى موعد تقديم العروض", reasonEn: "Submission deadline has passed" };
  const whole = Math.floor(days);
  return {
    ratio: clamp01(days / COMFORTABLE_PREP_DAYS),
    reasonAr:
      days >= COMFORTABLE_PREP_DAYS
        ? `متبقٍ ${whole} يومًا — وقت كافٍ لإعداد عرض قوي`
        : `متبقٍ ${whole} يومًا فقط لإعداد العرض (يُفضّل ${COMFORTABLE_PREP_DAYS} يومًا)`,
    reasonEn:
      days >= COMFORTABLE_PREP_DAYS
        ? `${whole} days left — ample time to prepare a strong bid`
        : `Only ${whole} days left to prepare (${COMFORTABLE_PREP_DAYS}+ preferred)`,
  };
}

function pastPerformance({ tender, profile }: ScoringInput): FactorResult {
  const matching = profile.pastProjects.filter((p) => p.sector === tender.sector);
  if (matching.length === 0) {
    return { ratio: 0.3, reasonAr: "لا يوجد سجل أداء سابق في هذا القطاع", reasonEn: "No past performance in this sector" };
  }
  const avg = matching.reduce((sum, p) => sum + p.performanceRating, 0) / matching.length;
  const pct = (avg * 100).toFixed(0);
  return {
    ratio: clamp01(avg),
    reasonAr: `${matching.length} مشروع سابق في القطاع بمتوسط أداء ${pct}%`,
    reasonEn: `${matching.length} past project(s) in this sector averaging ${pct}% performance`,
  };
}

const COMPUTERS: Record<FactorKey, (input: ScoringInput) => FactorResult> = {
  sector_match: sectorMatch,
  classification_eligibility: classificationEligibility,
  certification_coverage: certificationCoverage,
  value_fit: valueFit,
  deadline_feasibility: deadlineFeasibility,
  past_performance: pastPerformance,
};

/** One decimal place keeps scores stable and presentable. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Pure, deterministic, explainable scoring of a (tender, company) pair.
 * Same inputs always yield the same breakdown. No I/O, no clock, no LLM.
 *
 * Hard gates (classification) flag `disqualified` but the other factors are
 * still computed, so the user sees exactly why — and what it would take.
 */
export function scoreOpportunity(input: ScoringInput): ScoreBreakdown {
  const factors: ScoreFactor[] = [];
  let gate: FactorResult["gate"];

  for (const key of FACTOR_KEYS) {
    const meta = FACTORS[key];
    const result = COMPUTERS[key](input);
    const ratio = clamp01(result.ratio);
    factors.push({
      key: meta.key,
      labelAr: meta.labelAr,
      labelEn: meta.labelEn,
      weight: meta.weight,
      ratio,
      contribution: round1(meta.weight * ratio * 100),
      reasonAr: result.reasonAr,
      reasonEn: result.reasonEn,
    });
    gate ??= result.gate;
  }

  return {
    score: round1(factors.reduce((sum, f) => sum + f.contribution, 0)),
    factors,
    disqualified: gate !== undefined,
    disqualificationReasonAr: gate?.reasonAr ?? null,
    disqualificationReasonEn: gate?.reasonEn ?? null,
  };
}

/** Score bands used consistently by the API and the UI. */
export type ScoreBand = "high" | "medium" | "low";
export function scoreBand(score: number): ScoreBand {
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  return "low";
}
