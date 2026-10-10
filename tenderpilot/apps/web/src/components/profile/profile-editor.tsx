"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  CERTIFICATION_TYPES,
  CLASSIFICATION_FIELDS,
  SECTORS,
  certificationTypeSchema,
  classificationFieldSchema,
  classificationGradeSchema,
  companyProfileFormSchema,
  sectorSchema,
  type CompanyProfileForm,
  type RescoreImpact,
  type Sector,
} from "@tenderpilot/core/domain";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError, Input, Label, NativeSelect } from "@/components/ui/form";
import { Alert, Badge } from "@/components/ui/misc";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/** Form state keeps numbers as strings so half-typed input never fights the user. */
interface Draft {
  legalNameAr: string;
  legalNameEn: string;
  sectors: Sector[];
  annualTurnover: string;
  maxContractValue: string;
  classifications: { key: number; field: string; grade: string }[];
  certifications: { key: number; type: string; issuer: string; issuedAt: string; expiresAt: string; noExpiry: boolean }[];
  pastProjects: {
    key: number;
    titleAr: string;
    titleEn: string;
    sector: string;
    value: string;
    performancePct: string;
    year: string;
  }[];
}

const NUMERIC = new Set(["annualTurnover", "maxContractValue", "grade", "value", "performancePct", "year"]);
const KNOWN_CODES = ["DUPLICATE_FIELD", "DUPLICATE_CERTIFICATION", "EXPIRY_BEFORE_ISSUE", "CAPACITY_UNREALISTIC"] as const;
type KnownCode = (typeof KNOWN_CODES)[number];

let keySeq = 0;
const nextKey = () => ++keySeq;
const num = (s: string) => (s.trim() === "" ? Number.NaN : Number(s));

function toDraft(p: CompanyProfileForm): Draft {
  return {
    legalNameAr: p.legalNameAr,
    legalNameEn: p.legalNameEn,
    sectors: p.sectors,
    annualTurnover: String(p.annualTurnover),
    maxContractValue: String(p.maxContractValue),
    classifications: p.classifications.map((c) => ({ key: nextKey(), field: c.field, grade: String(c.grade) })),
    certifications: p.certifications.map((c) => ({
      key: nextKey(),
      type: c.type,
      issuer: c.issuer,
      issuedAt: c.issuedAt,
      expiresAt: c.expiresAt ?? "",
      noExpiry: c.expiresAt === null,
    })),
    pastProjects: p.pastProjects.map((x) => ({
      key: nextKey(),
      titleAr: x.titleAr,
      titleEn: x.titleEn,
      sector: x.sector,
      value: String(x.value),
      performancePct: String(x.performancePct),
      year: String(x.year),
    })),
  };
}

/** Draft → candidate payload. Validation happens in the shared schema, not here. */
function toCandidate(d: Draft): unknown {
  return {
    legalNameAr: d.legalNameAr,
    legalNameEn: d.legalNameEn,
    sectors: d.sectors,
    annualTurnover: num(d.annualTurnover),
    maxContractValue: num(d.maxContractValue),
    classifications: d.classifications.map((c) => ({ field: c.field, grade: num(c.grade) })),
    certifications: d.certifications.map((c) => ({
      type: c.type,
      issuer: c.issuer,
      issuedAt: c.issuedAt,
      expiresAt: c.noExpiry ? null : c.expiresAt,
    })),
    pastProjects: d.pastProjects.map((p) => ({
      titleAr: p.titleAr,
      titleEn: p.titleEn,
      sector: p.sector,
      value: num(p.value),
      performancePct: num(p.performancePct),
      year: num(p.year),
    })),
  };
}

function Section({ title, hint, error, children, action }: { title: string; hint: string; error?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{hint}</CardDescription>
        </div>
        {action}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {children}
        <FieldError message={error} />
      </CardContent>
    </Card>
  );
}

function Field({ id, label, error, children, className }: { id: string; label: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
      <FieldError message={error} />
    </div>
  );
}

export function ProfileEditor({ initial, canEdit }: { initial: CompanyProfileForm; canEdit: boolean }) {
  const t = useTranslations("profile");
  const tEnums = useTranslations("enums");
  const format = useFormatter();
  const router = useRouter();
  const trpc = useTRPC();
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const savedRef = useRef(JSON.stringify(toCandidate(toDraft(initial))));
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [impact, setImpact] = useState<RescoreImpact | null>(null);
  const dirty = JSON.stringify(toCandidate(draft)) !== savedRef.current;
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const save = useMutation(
    trpc.profile.update.mutationOptions({
      onSuccess: (result, variables) => {
        savedRef.current = JSON.stringify(variables);
        setImpact(result);
        router.refresh();
      },
    }),
  );

  const set = (patch: Partial<Draft>) => {
    setImpact(null);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const err = (path: string) => errors.get(path);

  function submit() {
    const parsed = companyProfileFormSchema.safeParse(toCandidate(draft));
    if (!parsed.success) {
      const next = new Map<string, string>();
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".");
        const last = String(issue.path.at(-1) ?? "");
        const code = KNOWN_CODES.find((c): c is KnownCode => c === issue.message);
        const message = code ? t(`errors.${code}`) : NUMERIC.has(last) ? t("errors.number") : t("errors.required");
        if (!next.has(path)) next.set(path, message);
      }
      setErrors(next);
      return;
    }
    setErrors(new Map());
    save.mutate(parsed.data);
  }

  const updateRow = <K extends "classifications" | "certifications" | "pastProjects">(
    list: K,
    key: number,
    patch: Partial<Draft[K][number]>,
  ) => set({ [list]: draft[list].map((row) => (row.key === key ? { ...row, ...patch } : row)) } as Partial<Draft>);
  const removeRow = (list: "classifications" | "certifications" | "pastProjects", key: number) =>
    set({ [list]: draft[list].filter((row) => row.key !== key) } as Partial<Draft>);

  const RemoveButton = ({ onClick }: { onClick: () => void }) => (
    <Button variant="ghost" size="icon" onClick={onClick} aria-label={t("remove")} title={t("remove")} className="self-end">
      <Trash2 className="text-muted-foreground" />
    </Button>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-6 pb-24"
      noValidate
    >
      <fieldset disabled={!canEdit || save.isPending} className="flex flex-col gap-6">
        <Section title={t("sections.basics")} hint={t("sections.basicsHint")}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field id="legalNameAr" label={t("fields.legalNameAr")} error={err("legalNameAr")}>
              <Input id="legalNameAr" dir="rtl" lang="ar" value={draft.legalNameAr} onChange={(e) => set({ legalNameAr: e.target.value })} aria-invalid={!!err("legalNameAr") || undefined} />
            </Field>
            <Field id="legalNameEn" label={t("fields.legalNameEn")} error={err("legalNameEn")}>
              <Input id="legalNameEn" dir="ltr" lang="en" value={draft.legalNameEn} onChange={(e) => set({ legalNameEn: e.target.value })} aria-invalid={!!err("legalNameEn") || undefined} />
            </Field>
            <Field id="annualTurnover" label={t("fields.annualTurnover")} error={err("annualTurnover")}>
              <Input id="annualTurnover" type="number" inputMode="numeric" min={0} step={100000} dir="ltr" value={draft.annualTurnover} onChange={(e) => set({ annualTurnover: e.target.value })} aria-invalid={!!err("annualTurnover") || undefined} />
            </Field>
            <Field id="maxContractValue" label={t("fields.maxContractValue")} error={err("maxContractValue")}>
              <Input id="maxContractValue" type="number" inputMode="numeric" min={0} step={100000} dir="ltr" value={draft.maxContractValue} onChange={(e) => set({ maxContractValue: e.target.value })} aria-invalid={!!err("maxContractValue") || undefined} />
            </Field>
          </div>
        </Section>

        <Section title={t("sections.sectors")} hint={t("sections.sectorsHint")} error={err("sectors")}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {SECTORS.map((s) => (
              <label key={s} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm has-checked:border-primary has-checked:bg-primary/8">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={draft.sectors.includes(s)}
                  onChange={(e) => set({ sectors: e.target.checked ? [...draft.sectors, s] : draft.sectors.filter((x) => x !== s) })}
                />
                {tEnums(`sector.${s}`)}
              </label>
            ))}
          </div>
        </Section>

        <Section
          title={t("sections.classifications")}
          hint={t("sections.classificationsHint")}
          error={err("classifications")}
          action={
            <Button variant="outline" size="sm" onClick={() => set({ classifications: [...draft.classifications, { key: nextKey(), field: CLASSIFICATION_FIELDS.find((f) => !draft.classifications.some((c) => c.field === f)) ?? "buildings", grade: "3" }] })}>
              <Plus />
              {t("add.classification")}
            </Button>
          }
        >
          {draft.classifications.length === 0 && <p className="text-sm text-muted-foreground">{t("empty.classifications")}</p>}
          {draft.classifications.map((c, i) => (
            <div key={c.key} className="grid grid-cols-[1fr_8rem_auto] items-start gap-3">
              <Field id={`cls-field-${c.key}`} label={t("fields.field")} error={err(`classifications.${i}.field`)}>
                <NativeSelect id={`cls-field-${c.key}`} value={c.field} onChange={(e) => updateRow("classifications", c.key, { field: classificationFieldSchema.parse(e.target.value) })}>
                  {CLASSIFICATION_FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {tEnums(`classificationField.${f}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id={`cls-grade-${c.key}`} label={t("fields.grade")} error={err(`classifications.${i}.grade`)}>
                <NativeSelect id={`cls-grade-${c.key}`} value={c.grade} onChange={(e) => updateRow("classifications", c.key, { grade: String(classificationGradeSchema.parse(Number(e.target.value))) })}>
                  {[1, 2, 3, 4, 5].map((g) => (
                    <option key={g} value={g}>
                      {t("fields.gradeOption", { grade: g })}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <RemoveButton onClick={() => removeRow("classifications", c.key)} />
            </div>
          ))}
        </Section>

        <Section
          title={t("sections.certifications")}
          hint={t("sections.certificationsHint")}
          error={err("certifications")}
          action={
            <Button variant="outline" size="sm" onClick={() => set({ certifications: [...draft.certifications, { key: nextKey(), type: CERTIFICATION_TYPES.find((ct) => !draft.certifications.some((c) => c.type === ct)) ?? "iso_9001", issuer: "", issuedAt: today, expiresAt: "", noExpiry: false }] })}>
              <Plus />
              {t("add.certification")}
            </Button>
          }
        >
          {draft.certifications.length === 0 && <p className="text-sm text-muted-foreground">{t("empty.certifications")}</p>}
          {draft.certifications.map((c, i) => {
            const days = !c.noExpiry && c.expiresAt ? Math.floor((Date.parse(c.expiresAt) - Date.parse(today)) / 86_400_000) : null;
            return (
              <div key={c.key} className="flex flex-col gap-3 rounded-lg border p-3">
                <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-[1.4fr_1fr_auto]">
                  <Field id={`cert-type-${c.key}`} label={t("fields.type")} error={err(`certifications.${i}.type`)}>
                    <NativeSelect id={`cert-type-${c.key}`} value={c.type} onChange={(e) => updateRow("certifications", c.key, { type: certificationTypeSchema.parse(e.target.value) })}>
                      {CERTIFICATION_TYPES.map((ct) => (
                        <option key={ct} value={ct}>
                          {tEnums(`certification.${ct}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field id={`cert-issuer-${c.key}`} label={t("fields.issuer")} error={err(`certifications.${i}.issuer`)}>
                    <Input id={`cert-issuer-${c.key}`} value={c.issuer} onChange={(e) => updateRow("certifications", c.key, { issuer: e.target.value })} aria-invalid={!!err(`certifications.${i}.issuer`) || undefined} />
                  </Field>
                  <RemoveButton onClick={() => removeRow("certifications", c.key)} />
                </div>
                <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[1fr_1fr_auto]">
                  <Field id={`cert-issued-${c.key}`} label={t("fields.issuedAt")} error={err(`certifications.${i}.issuedAt`)}>
                    <Input id={`cert-issued-${c.key}`} type="date" dir="ltr" value={c.issuedAt} onChange={(e) => updateRow("certifications", c.key, { issuedAt: e.target.value })} />
                  </Field>
                  <Field id={`cert-expires-${c.key}`} label={t("fields.expiresAt")} error={err(`certifications.${i}.expiresAt`)}>
                    <Input id={`cert-expires-${c.key}`} type="date" dir="ltr" disabled={c.noExpiry} value={c.noExpiry ? "" : c.expiresAt} onChange={(e) => updateRow("certifications", c.key, { expiresAt: e.target.value })} aria-invalid={!!err(`certifications.${i}.expiresAt`) || undefined} />
                  </Field>
                  <div className="flex items-center gap-3 sm:pt-6">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={c.noExpiry} onChange={(e) => updateRow("certifications", c.key, { noExpiry: e.target.checked })} />
                      {t("fields.noExpiry")}
                    </label>
                    {days !== null && days < 0 && <Badge variant="destructive">{t("expired")}</Badge>}
                    {days !== null && days >= 0 && days <= 60 && <Badge variant="warning">{t("expiresSoon", { days })}</Badge>}
                  </div>
                </div>
              </div>
            );
          })}
        </Section>

        <Section
          title={t("sections.pastProjects")}
          hint={t("sections.pastProjectsHint")}
          error={err("pastProjects")}
          action={
            <Button variant="outline" size="sm" onClick={() => set({ pastProjects: [...draft.pastProjects, { key: nextKey(), titleAr: "", titleEn: "", sector: draft.sectors[0] ?? "construction", value: "", performancePct: "80", year: String(new Date().getFullYear()) }] })}>
              <Plus />
              {t("add.project")}
            </Button>
          }
        >
          {draft.pastProjects.length === 0 && <p className="text-sm text-muted-foreground">{t("empty.pastProjects")}</p>}
          {draft.pastProjects.map((p, i) => (
            <div key={p.key} className="flex flex-col gap-3 rounded-lg border p-3">
              <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-[1fr_1fr_auto]">
                <Field id={`pp-ar-${p.key}`} label={t("fields.titleAr")} error={err(`pastProjects.${i}.titleAr`)}>
                  <Input id={`pp-ar-${p.key}`} dir="rtl" lang="ar" value={p.titleAr} onChange={(e) => updateRow("pastProjects", p.key, { titleAr: e.target.value })} aria-invalid={!!err(`pastProjects.${i}.titleAr`) || undefined} />
                </Field>
                <Field id={`pp-en-${p.key}`} label={t("fields.titleEn")} error={err(`pastProjects.${i}.titleEn`)}>
                  <Input id={`pp-en-${p.key}`} dir="ltr" lang="en" value={p.titleEn} onChange={(e) => updateRow("pastProjects", p.key, { titleEn: e.target.value })} aria-invalid={!!err(`pastProjects.${i}.titleEn`) || undefined} />
                </Field>
                <RemoveButton onClick={() => removeRow("pastProjects", p.key)} />
              </div>
              <div className="grid grid-cols-2 items-start gap-3 md:grid-cols-4">
                <Field id={`pp-sector-${p.key}`} label={t("fields.sector")}>
                  <NativeSelect id={`pp-sector-${p.key}`} value={p.sector} onChange={(e) => updateRow("pastProjects", p.key, { sector: sectorSchema.parse(e.target.value) })}>
                    {SECTORS.map((s) => (
                      <option key={s} value={s}>
                        {tEnums(`sector.${s}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field id={`pp-value-${p.key}`} label={t("fields.value")} error={err(`pastProjects.${i}.value`)}>
                  <Input id={`pp-value-${p.key}`} type="number" inputMode="numeric" min={0} dir="ltr" value={p.value} onChange={(e) => updateRow("pastProjects", p.key, { value: e.target.value })} aria-invalid={!!err(`pastProjects.${i}.value`) || undefined} />
                </Field>
                <Field id={`pp-perf-${p.key}`} label={t("fields.performance")} error={err(`pastProjects.${i}.performancePct`)}>
                  <Input id={`pp-perf-${p.key}`} type="number" inputMode="numeric" min={0} max={100} dir="ltr" value={p.performancePct} onChange={(e) => updateRow("pastProjects", p.key, { performancePct: e.target.value })} aria-invalid={!!err(`pastProjects.${i}.performancePct`) || undefined} />
                </Field>
                <Field id={`pp-year-${p.key}`} label={t("fields.year")} error={err(`pastProjects.${i}.year`)}>
                  <Input id={`pp-year-${p.key}`} type="number" inputMode="numeric" min={1990} max={2100} dir="ltr" value={p.year} onChange={(e) => updateRow("pastProjects", p.key, { year: e.target.value })} aria-invalid={!!err(`pastProjects.${i}.year`) || undefined} />
                </Field>
              </div>
            </div>
          ))}
        </Section>
      </fieldset>

      {canEdit && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur md:start-60">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 md:px-6">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm" role="status" aria-live="polite">
              {errors.size > 0 && <span className="text-destructive">{t("errors.invalid")}</span>}
              {save.isError && <span className="text-destructive">{t("errors.save")}</span>}
              {errors.size === 0 && !save.isError && dirty && <span className="text-muted-foreground">{t("unsaved")}</span>}
              {impact && !dirty && (
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="flex items-center gap-1 font-medium text-success">
                    <CheckCircle2 className="size-4" />
                    {t("impact.title", { count: impact.scored })}
                  </span>
                  {impact.improved + impact.declined + impact.newlyEligible + impact.newlyDisqualified === 0 ? (
                    <span className="text-muted-foreground">{t("impact.noChange")}</span>
                  ) : (
                    <>
                      {impact.improved > 0 && <Badge variant="success">{t("impact.improved", { count: impact.improved })}</Badge>}
                      {impact.declined > 0 && <Badge variant="warning">{t("impact.declined", { count: impact.declined })}</Badge>}
                      {impact.newlyEligible > 0 && <Badge variant="success">{t("impact.newlyEligible", { count: impact.newlyEligible })}</Badge>}
                      {impact.newlyDisqualified > 0 && <Badge variant="destructive">{t("impact.newlyDisqualified", { count: impact.newlyDisqualified })}</Badge>}
                      {impact.averageBefore !== null && impact.averageAfter !== null && (
                        <span className="text-xs text-muted-foreground">
                          {t("impact.average", {
                            before: format.number(impact.averageBefore, "score"),
                            after: format.number(impact.averageAfter, "score"),
                          })}
                        </span>
                      )}
                    </>
                  )}
                </span>
              )}
            </div>
            <Button type="submit" disabled={!dirty || save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {save.isPending ? t("saving") : t("save")}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
