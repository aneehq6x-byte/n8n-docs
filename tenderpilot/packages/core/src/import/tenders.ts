import {
  CERTIFICATION_LABELS,
  CERTIFICATION_TYPES,
  CLASSIFICATION_FIELD_LABELS,
  CLASSIFICATION_FIELDS,
  SECTORS,
  SECTOR_LABELS,
  type CertificationType,
  type ClassificationField,
  type ClassificationGrade,
  type Sector,
} from "../domain/enums";
import { rawTenderSchema, type RawTender } from "../domain/raw-tender";
import type { TenderConnector } from "../scout/connector";
import { csvCell, parseCsv } from "./csv";

export const IMPORT_LIMITS = { maxBytes: 2 * 1024 * 1024, maxRows: 1000 } as const;

/** Canonical columns. Arabic aliases let teams paste sheets with Arabic headers. */
export const IMPORT_COLUMNS = {
  source_ref: { required: true, aliases: ["الرقم المرجعي", "رقم المنافسة", "reference", "tender_number"] },
  title_ar: { required: true, aliases: ["اسم المنافسة", "عنوان المنافسة", "العنوان"] },
  title_en: { required: false, aliases: ["title", "tender_title"] },
  issuer_ar: { required: true, aliases: ["الجهة", "الجهة الحكومية", "الجهة المالكة"] },
  issuer_en: { required: false, aliases: ["issuer", "entity"] },
  sector: { required: true, aliases: ["القطاع", "النشاط"] },
  deadline: { required: true, aliases: ["آخر موعد لتقديم العروض", "الموعد النهائي", "submission_deadline"] },
  value_sar: { required: false, aliases: ["القيمة التقديرية", "القيمة", "value", "estimated_value"] },
  published_at: { required: false, aliases: ["تاريخ الطرح", "تاريخ النشر", "published"] },
  description_ar: { required: false, aliases: ["الوصف", "نطاق العمل"] },
  description_en: { required: false, aliases: ["description", "scope"] },
  region_ar: { required: false, aliases: ["المنطقة"] },
  region_en: { required: false, aliases: ["region"] },
  classification: { required: false, aliases: ["التصنيف المطلوب", "التصنيف", "required_classification"] },
  certifications: { required: false, aliases: ["الشهادات المطلوبة", "الشهادات", "required_certifications"] },
  bid_bond_pct: { required: false, aliases: ["الضمان الابتدائي", "bid_bond"] },
  performance_bond_pct: { required: false, aliases: ["الضمان النهائي", "performance_bond"] },
  source: { required: false, aliases: ["المصدر"] },
} as const;
export type ImportColumn = keyof typeof IMPORT_COLUMNS;
const COLUMN_KEYS = Object.keys(IMPORT_COLUMNS) as ImportColumn[];

export const IMPORT_ERROR_CODES = [
  "REQUIRED",
  "INVALID_SECTOR",
  "INVALID_DATE",
  "INVALID_NUMBER",
  "INVALID_CLASSIFICATION",
  "INVALID_CERTIFICATION",
  "DEADLINE_BEFORE_PUBLISH",
  "DUPLICATE_REF",
  "INVALID_ROW",
] as const;
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

export interface ImportRowError {
  /** 1-based line in the file (header = line 1). */
  line: number;
  column: ImportColumn | null;
  code: ImportErrorCode;
  value?: string;
}

export type ImportFileError = "FILE_TOO_LARGE" | "EMPTY" | "MISSING_COLUMNS" | "TOO_MANY_ROWS";

export interface ImportResult {
  tenders: RawTender[];
  errors: ImportRowError[];
  totalRows: number;
  fileError: ImportFileError | null;
  missingColumns: ImportColumn[];
}

const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/[\s\-]+/g, "_");
const normalizeLabel = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function matchEnum<T extends string>(raw: string, keys: readonly T[], labels: Record<T, { ar: string; en: string }>): T | null {
  const v = normalizeLabel(raw);
  return keys.find((k) => k === v.replace(/ /g, "_") || normalizeLabel(labels[k].ar) === v || normalizeLabel(labels[k].en) === v) ?? null;
}

/** Arabic-Indic and Persian digits → ASCII, Arabic thousands/decimal separators normalised. */
function westernDigits(s: string): string {
  return s
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\u066C/g, ",")
    .replace(/\u066B/g, ".");
}

function parseNumber(raw: string): number | null {
  const cleaned = westernDigits(raw).replace(/[,\s]|ر\.س\.?|sar|ريال/gi, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** YYYY-MM-DD[ HH:mm] or DD/MM/YYYY (Saudi convention). Interpreted in Riyadh time (UTC+3). */
function parseDate(raw: string, endOfDay: boolean): Date | null {
  const s = westernDigits(raw).trim();
  let y: number, m: number, d: number, hh = endOfDay ? 23 : 0, mm = endOfDay ? 59 : 0;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  const dmy = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dmy) [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
  else return null;
  const time = iso?.[4] !== undefined ? iso : dmy?.[4] !== undefined ? dmy : null;
  if (time) [hh, mm] = [Number(time[4]), Number(time[5])];
  if (hh > 23 || mm > 59 || y < 2000 || y > 2100) return null;
  // Reject impossible calendar dates (31/02, 13/2026 …).
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000; // Saudi Arabia is UTC+3, no DST
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - RIYADH_OFFSET_MS);
}

/** Percent like "2", "2%", "0.02" → fraction. */
function parsePct(raw: string, fallback: number): number | null {
  if (raw.trim() === "") return fallback;
  const n = parseNumber(raw.replace("%", ""));
  if (n === null || Number.isNaN(n) || n < 0) return null;
  const fraction = n > 1 ? n / 100 : n;
  return fraction <= 1 ? fraction : null;
}

/** "buildings:3", "المباني 3", "roads - 2" → field + grade. */
function parseClassification(raw: string): { field: ClassificationField; grade: ClassificationGrade } | null {
  const m = westernDigits(raw).trim().match(/^(.+?)[\s:\-–—]+([1-5])$/);
  if (!m?.[1] || !m[2]) return null;
  const field = matchEnum(m[1], CLASSIFICATION_FIELDS, CLASSIFICATION_FIELD_LABELS);
  const grade = Number(m[2]);
  return field && (grade === 1 || grade === 2 || grade === 3 || grade === 4 || grade === 5) ? { field, grade } : null;
}

/**
 * Turn CSV text into validated RawTenders. Every rejected cell is reported
 * with its line and column; valid rows are still returned (partial imports).
 */
export function parseTenderImport(text: string, now: Date = new Date()): ImportResult {
  const empty = (fileError: ImportFileError, missingColumns: ImportColumn[] = []): ImportResult => ({
    tenders: [],
    errors: [],
    totalRows: 0,
    fileError,
    missingColumns,
  });
  if (new TextEncoder().encode(text).length > IMPORT_LIMITS.maxBytes) return empty("FILE_TOO_LARGE");
  const table = parseCsv(text);
  const [header, ...body] = table;
  if (!header || body.length === 0) return empty("EMPTY");
  if (body.length > IMPORT_LIMITS.maxRows) return empty("TOO_MANY_ROWS");

  const index = new Map<ImportColumn, number>();
  header.forEach((h, i) => {
    const n = normalizeHeader(h);
    const col = COLUMN_KEYS.find((k) => k === n || IMPORT_COLUMNS[k].aliases.some((a) => normalizeHeader(a) === n));
    if (col && !index.has(col)) index.set(col, i);
  });
  const missing = COLUMN_KEYS.filter((k) => IMPORT_COLUMNS[k].required && !index.has(k));
  if (missing.length > 0) return empty("MISSING_COLUMNS", missing);

  const tenders: RawTender[] = [];
  const errors: ImportRowError[] = [];
  const seen = new Set<string>();

  body.forEach((cells, i) => {
    const line = i + 2;
    const get = (c: ImportColumn) => {
      const at = index.get(c);
      return at === undefined ? "" : (cells[at] ?? "").trim();
    };
    const rowErrors: ImportRowError[] = [];
    const fail = (column: ImportColumn | null, code: ImportErrorCode, value?: string) =>
      rowErrors.push({ line, column, code, ...(value ? { value: value.slice(0, 80) } : {}) });

    for (const c of COLUMN_KEYS) if (IMPORT_COLUMNS[c].required && !get(c)) fail(c, "REQUIRED");

    const sector: Sector | null = get("sector") ? matchEnum(get("sector"), SECTORS, SECTOR_LABELS) : null;
    if (get("sector") && !sector) fail("sector", "INVALID_SECTOR", get("sector"));

    const deadline = get("deadline") ? parseDate(get("deadline"), true) : null;
    if (get("deadline") && !deadline) fail("deadline", "INVALID_DATE", get("deadline"));
    const published = get("published_at") ? parseDate(get("published_at"), false) : now;
    if (!published) fail("published_at", "INVALID_DATE", get("published_at"));
    if (deadline && published && deadline <= published) fail("deadline", "DEADLINE_BEFORE_PUBLISH", get("deadline"));

    const value = parseNumber(get("value_sar"));
    if (value !== null && (Number.isNaN(value) || value < 0)) fail("value_sar", "INVALID_NUMBER", get("value_sar"));

    const classification = get("classification") ? parseClassification(get("classification")) : null;
    if (get("classification") && !classification) fail("classification", "INVALID_CLASSIFICATION", get("classification"));

    const certifications: CertificationType[] = [];
    for (const part of get("certifications").split(/[;،|]/).map((s) => s.trim()).filter(Boolean)) {
      const cert = matchEnum(part, CERTIFICATION_TYPES, CERTIFICATION_LABELS);
      if (cert) certifications.push(cert);
      else fail("certifications", "INVALID_CERTIFICATION", part);
    }

    const bidBond = parsePct(get("bid_bond_pct"), 0.02);
    if (bidBond === null) fail("bid_bond_pct", "INVALID_NUMBER", get("bid_bond_pct"));
    const perfBond = parsePct(get("performance_bond_pct"), 0.05);
    if (perfBond === null) fail("performance_bond_pct", "INVALID_NUMBER", get("performance_bond_pct"));

    const source = (get("source") || "manual").toLowerCase().replace(/[^a-z0-9_-]/g, "") || "manual";
    const ref = westernDigits(get("source_ref"));
    if (ref && seen.has(`${source}::${ref}`)) fail("source_ref", "DUPLICATE_REF", ref);

    if (rowErrors.length > 0 || !sector || !deadline || !published || bidBond === null || perfBond === null) {
      errors.push(...rowErrors);
      return;
    }
    seen.add(`${source}::${ref}`);

    const candidate = {
      sourceRef: ref,
      source,
      entity: {
        nameAr: get("issuer_ar"),
        nameEn: get("issuer_en") || get("issuer_ar"),
        kind: "government",
        regionAr: get("region_ar") || null,
        regionEn: get("region_en") || get("region_ar") || null,
      },
      titleAr: get("title_ar"),
      titleEn: get("title_en") || get("title_ar"),
      descriptionAr: get("description_ar") || get("title_ar"),
      descriptionEn: get("description_en") || get("title_en") || get("description_ar") || get("title_ar"),
      sector,
      valueEstimate: value,
      requiredClassificationField: classification?.field ?? null,
      requiredClassificationGrade: classification?.grade ?? null,
      requiredCertifications: [...new Set(certifications)],
      bidBondPct: bidBond,
      performanceBondPct: perfBond,
      publishedAt: published.toISOString(),
      submissionDeadline: deadline.toISOString(),
      rawDocumentRefs: [],
    };
    const parsed = rawTenderSchema.safeParse(candidate);
    if (parsed.success) tenders.push(parsed.data);
    else errors.push({ line, column: null, code: "INVALID_ROW" });
  });

  return { tenders, errors, totalRows: body.length, fileError: null, missingColumns: [] };
}

/** Feeds already-validated imported rows through the standard Scout pipeline. */
export class CsvImportConnector implements TenderConnector {
  readonly source = "csv-import";
  constructor(private readonly rows: readonly RawTender[]) {}
  async fetchTenders(): Promise<RawTender[]> {
    return this.rows.map((r) => rawTenderSchema.parse(r));
  }
}

/** A filled-in template with Arabic + English headers and two realistic rows. */
export function importTemplateCsv(): string {
  const header = COLUMN_KEYS;
  const rows: Record<ImportColumn, string>[] = [
    {
      source_ref: "250701445210",
      title_ar: "صيانة مباني المدارس في محافظة جدة",
      title_en: "Maintenance of school buildings in Jeddah Governorate",
      issuer_ar: "وزارة التعليم",
      issuer_en: "Ministry of Education",
      sector: "facilities_management",
      deadline: "2026-12-15",
      value_sar: "14,500,000",
      published_at: "2026-10-01",
      description_ar: "صيانة وقائية وتصحيحية لمباني 85 مدرسة لمدة 24 شهرًا.",
      description_en: "Preventive and corrective maintenance of 85 school buildings for 24 months.",
      region_ar: "منطقة مكة المكرمة",
      region_en: "Makkah Region",
      classification: "operation_and_maintenance:3",
      certifications: "iso_9001;saudization_nitaqat",
      bid_bond_pct: "2",
      performance_bond_pct: "5",
      source: "etimad",
    },
    {
      source_ref: "250702118904",
      title_ar: "إنشاء مبنى إداري لفرع الوزارة في أبها",
      title_en: "",
      issuer_ar: "وزارة الموارد البشرية والتنمية الاجتماعية",
      issuer_en: "",
      sector: "الإنشاءات والمقاولات",
      deadline: "20/12/2026",
      value_sar: "",
      published_at: "",
      description_ar: "",
      description_en: "",
      region_ar: "منطقة عسير",
      region_en: "",
      classification: "المباني 3",
      certifications: "آيزو 9001 لإدارة الجودة",
      bid_bond_pct: "",
      performance_bond_pct: "",
      source: "",
    },
  ];
  return [header.join(","), ...rows.map((r) => header.map((h) => csvCell(r[h])).join(","))].join("\r\n") + "\r\n";
}
