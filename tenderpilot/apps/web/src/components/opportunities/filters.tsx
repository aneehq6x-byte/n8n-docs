"use client";

import { Loader2, RotateCcw, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  DEADLINE_WINDOWS,
  ELIGIBILITY_FILTERS,
  MIN_SCORE_OPTIONS,
  OPPORTUNITY_STATUSES,
  SECTORS,
  parseOpportunityQuery,
  serializeOpportunityQuery,
  type OpportunityListQuery,
} from "@tenderpilot/core/domain";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/form";
import { usePathname, useRouter } from "@/i18n/navigation";

const DEADLINE_LABEL = { any: "deadlineAny", week: "deadlineWeek", month: "deadlineMonth", closed: "deadlineClosed" } as const;
const ELIGIBILITY_LABEL = {
  all: "eligibilityAll",
  eligible: "eligibilityEligible",
  disqualified: "eligibilityDisqualified",
} as const;

/** One filter row above the table; state lives in the URL so views are shareable and back-button friendly. */
export function OpportunityFilters() {
  const t = useTranslations("opportunities");
  const tEnums = useTranslations("enums");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const current = parseOpportunityQuery(Object.fromEntries(searchParams));
  const [q, setQ] = useState(current.q ?? "");
  const firstRender = useRef(true);

  function apply(patch: Partial<OpportunityListQuery>) {
    // Any filter change returns to page 1.
    const next = serializeOpportunityQuery({ ...current, page: 1, ...patch });
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  // Debounced search.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const handle = setTimeout(() => apply({ q: q.trim() || undefined }), 350);
    return () => clearTimeout(handle);
    // Intentionally keyed on the search text only.
  }, [q]);

  const active =
    current.q || current.sector || current.status || current.minScore !== undefined || current.deadline !== "any" || current.eligibility !== "all";

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 md:flex-row md:flex-wrap md:items-center">
      <div className="relative min-w-56 flex-1">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchLabel")}
          className="ps-9"
        />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:flex md:flex-wrap">
        <NativeSelect
          aria-label={t("filters.sector")}
          value={current.sector ?? ""}
          onChange={(e) => apply({ sector: SECTORS.find((s) => s === e.target.value) })}
          className="md:w-44"
        >
          <option value="">{t("filters.allSectors")}</option>
          {SECTORS.map((s) => (
            <option key={s} value={s}>
              {tEnums(`sector.${s}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={t("filters.status")}
          value={current.status ?? ""}
          onChange={(e) => apply({ status: OPPORTUNITY_STATUSES.find((s) => s === e.target.value) })}
          className="md:w-40"
        >
          <option value="">{t("filters.allStatuses")}</option>
          {OPPORTUNITY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {tEnums(`opportunityStatus.${s}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={t("filters.eligibility")}
          value={current.eligibility}
          onChange={(e) => apply({ eligibility: ELIGIBILITY_FILTERS.find((s) => s === e.target.value) ?? "all" })}
          className="md:w-40"
        >
          {ELIGIBILITY_FILTERS.map((s) => (
            <option key={s} value={s}>
              {t(`filters.${ELIGIBILITY_LABEL[s]}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={t("filters.deadline")}
          value={current.deadline}
          onChange={(e) => apply({ deadline: DEADLINE_WINDOWS.find((s) => s === e.target.value) ?? "any" })}
          className="md:w-36"
        >
          {DEADLINE_WINDOWS.map((s) => (
            <option key={s} value={s}>
              {t(`filters.${DEADLINE_LABEL[s]}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={t("filters.minScore")}
          value={current.minScore === undefined ? "" : String(current.minScore)}
          onChange={(e) => apply({ minScore: MIN_SCORE_OPTIONS.find((s) => String(s) === e.target.value) })}
          className="md:w-36"
        >
          <option value="">{t("filters.scoreAny")}</option>
          <option value="50">{t("filters.score50")}</option>
          <option value="75">{t("filters.score75")}</option>
        </NativeSelect>
      </div>
      <div className="flex items-center gap-2 md:ms-auto">
        {pending && <Loader2 aria-label="…" className="size-4 animate-spin text-muted-foreground" />}
        {active && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ("");
              startTransition(() => router.replace(pathname, { scroll: false }));
            }}
          >
            <RotateCcw />
            {t("filters.reset")}
          </Button>
        )}
      </div>
    </div>
  );
}
