"use client";

import { useMutation } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { AlertTriangle, CheckCircle2, Download, FileUp, Loader2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { importTemplateCsv } from "@tenderpilot/core/import";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError, Label } from "@/components/ui/form";
import { Alert, Badge } from "@/components/ui/misc";
import { Link } from "@/i18n/navigation";
import { useTRPC } from "@/trpc/client";

/** Excel in Arabic locales often saves CSV as Windows-1256; fall back when UTF-8 decoding is lossy. */
async function readCsvFile(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  return utf8.includes("�") ? new TextDecoder("windows-1256").decode(bytes) : utf8;
}

function downloadTemplate() {
  // BOM so Excel opens the UTF-8 Arabic text correctly.
  const blob = new Blob(["﻿", importTemplateCsv()], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: "tenderpilot-import-template.csv" });
  a.click();
  URL.revokeObjectURL(url);
}

export function TenderImporter() {
  const t = useTranslations("import");
  const tSector = useTranslations("enums.sector");
  const format = useFormatter();
  const trpc = useTRPC();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState("");
  const preview = useMutation(trpc.import.preview.mutationOptions());
  const commit = useMutation(trpc.import.commit.mutationOptions());
  const p = preview.data;
  const commitErrorKey =
    commit.error instanceof TRPCClientError && commit.error.message === "SUBSCRIPTION_INACTIVE" ? "SUBSCRIPTION_INACTIVE" : "generic";

  const reset = () => {
    preview.reset();
    commit.reset();
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <CardTitle>{t("choose")}</CardTitle>
            <CardDescription>{t("templateHint")}</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <Download />
            {t("template")}
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground hover:bg-accent/40">
            <FileUp className="size-6 text-primary" />
            <span className="font-medium text-foreground">{t("choose")}</span>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const text = await readCsvFile(file);
                setCsv(text);
                reset();
                preview.mutate({ csv: text });
              }}
            />
          </label>
          <div className="flex flex-col gap-2">
            <Label htmlFor="csv-paste" className="text-xs text-muted-foreground">
              {t("or")}
            </Label>
            <textarea
              id="csv-paste"
              dir="auto"
              rows={5}
              value={csv}
              onChange={(e) => {
                setCsv(e.target.value);
                reset();
              }}
              aria-label={t("pasteLabel")}
              className="w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            />
          </div>
          <Button className="self-start" disabled={!csv.trim() || preview.isPending} onClick={() => preview.mutate({ csv })}>
            {preview.isPending && <Loader2 className="animate-spin" />}
            {preview.isPending ? t("validating") : t("preview")}
          </Button>
        </CardContent>
      </Card>

      {p?.fileError && (
        <Alert variant="destructive">
          <AlertTriangle />
          {p.fileError === "MISSING_COLUMNS" ? t("fileError.MISSING_COLUMNS", { columns: p.missingColumns.join(", ") }) : t(`fileError.${p.fileError}`)}
        </Alert>
      )}

      {p && !p.fileError && (
        <Card>
          <CardHeader>
            <CardTitle>{t("summary", { valid: p.valid, total: p.totalRows })}</CardTitle>
            {p.errorCount > 0 && <CardDescription>{t("errorsHint")}</CardDescription>}
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {p.errorCount > 0 && (
              <div className="flex flex-col gap-2">
                <span className="flex items-center gap-2 text-sm font-medium text-destructive">
                  <AlertTriangle className="size-4" />
                  {t("errorsTitle", { count: p.errorCount })}
                </span>
                <ul className="max-h-64 overflow-auto rounded-md border text-sm">
                  {p.errors.map((e, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-3 py-2 last:border-b-0">
                      <span className="tabular-nums text-muted-foreground">{t("line", { line: e.line })}</span>
                      {e.column && <code className="ltr-nums rounded bg-muted px-1.5 text-xs">{e.column}</code>}
                      <span>{t(`codes.${e.code}`)}</span>
                      {e.value && <span className="ltr-nums truncate text-xs text-muted-foreground">“{e.value}”</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {p.sample.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">{t("sampleTitle")}</span>
                <ul className="flex flex-col divide-y rounded-md border text-sm">
                  {p.sample.map((s) => (
                    <li key={s.sourceRef} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                      <span className="ltr-nums text-xs text-muted-foreground">#{s.sourceRef}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{s.titleAr}</span>
                      <Badge variant="secondary">{tSector(s.sector)}</Badge>
                      <span className="tabular-nums text-xs">{format.dateTime(s.submissionDeadline, "short")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {commit.isSuccess ? (
              <div className="flex flex-wrap items-center gap-3">
                <span role="status" className="flex items-center gap-1.5 text-sm font-medium text-success">
                  <CheckCircle2 className="size-4" />
                  {t("done", commit.data)}
                </span>
                <Link href="/opportunities" className={buttonVariants({ size: "sm" })}>
                  {t("viewOpportunities")}
                </Link>
              </div>
            ) : (
              p.valid > 0 && (
                <Button className="self-start" disabled={commit.isPending} onClick={() => commit.mutate({ csv })}>
                  {commit.isPending && <Loader2 className="animate-spin" />}
                  {commit.isPending ? t("importing") : t("commit", { count: p.valid })}
                </Button>
              )
            )}
            <FieldError message={commit.isError ? t(`errors.${commitErrorKey}`) : undefined} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
