import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { IMPORT_LIMITS, parseTenderImport } from "@tenderpilot/core";
import { getOrgEntitlements, importTenders } from "@tenderpilot/db";
import { requirePermission, router } from "../init";

/** Small headroom over the byte limit: the parser reports FILE_TOO_LARGE precisely. */
const csvInput = z.object({ csv: z.string().max(IMPORT_LIMITS.maxBytes + 1024) });

export const importRouter = router({
  /** Validate without writing anything; returns per-cell errors and a sample. */
  preview: requirePermission("scout:run")
    .input(csvInput)
    .mutation(({ input }) => {
      const r = parseTenderImport(input.csv);
      return {
        fileError: r.fileError,
        missingColumns: r.missingColumns,
        totalRows: r.totalRows,
        valid: r.tenders.length,
        errors: r.errors.slice(0, 100),
        errorCount: r.errors.length,
        sample: r.tenders.slice(0, 5).map((t) => ({
          sourceRef: t.sourceRef,
          titleAr: t.titleAr,
          titleEn: t.titleEn,
          sector: t.sector,
          valueEstimate: t.valueEstimate,
          submissionDeadline: new Date(t.submissionDeadline),
        })),
      };
    }),

  /** Re-parses server-side (client-side results are never trusted), ingests valid rows, re-scores. */
  commit: requirePermission("scout:run")
    .input(csvInput)
    .mutation(async ({ ctx, input }) => {
      if (!(await getOrgEntitlements(ctx.db, ctx.orgId)).active) {
        throw new TRPCError({ code: "FORBIDDEN", message: "SUBSCRIPTION_INACTIVE" });
      }
      const r = parseTenderImport(input.csv);
      if (r.fileError || r.tenders.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "NOTHING_TO_IMPORT" });
      const result = await importTenders(ctx.db, ctx.orgId, r.tenders, ctx.user.id);
      return { ...result, skipped: r.totalRows - r.tenders.length };
    }),
});
