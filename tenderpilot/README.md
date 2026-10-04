# TenderPilot AI

Multi-tenant SaaS that discovers Saudi government tenders, scores each one against a
company's capabilities into an **explainable opportunity**, and surfaces them on a
bilingual dashboard — **Arabic (RTL) by default**, English secondary.

```
 Etimad / gov portals ──► Scout Agent ──► tenders ──► scout.tenders.ingested ──► Scoring ──► opportunities ──► Dashboard / Opportunities
   (TenderConnector)     (BullMQ job)    (Postgres)        (typed event)        (pure fn)    (score_breakdown)     (Next.js + tRPC)
```

## Monorepo

| Path | What it is |
| --- | --- |
| `packages/core` | Pure domain logic, no I/O: Zod domain schemas, RBAC matrix, `TenderConnector`s, Scout normalisation/dedupe, the **scoring engine**, fixtures. Client-safe subpaths: `@tenderpilot/core/domain`, `@tenderpilot/core/scoring`. |
| `packages/config` | Lazily-validated env (`getServerEnv`) + secrets abstraction (env / Azure Key Vault). |
| `packages/db` | Drizzle schema + migrations, Zod-validated row mappers, services (identity, company profile, scout ingest, scoring, opportunities), seed. |
| `packages/jobs` | BullMQ queues, typed payloads, processors, worker factory, connector registry, `scout:run` CLI. |
| `apps/web` | Next.js 16 (App Router), next-intl, next-auth, tRPC, Tailwind 4 / shadcn-style UI. |
| `apps/worker` | Worker process: Scout + scoring workers and the cron sweep. |
| `e2e` | Browser acceptance gate (Playwright). |

## Quick start

```bash
cp .env.example .env            # set NEXTAUTH_SECRET (openssl rand -base64 48)
cp .env apps/web/.env.local
pnpm install
pnpm infra:up                   # postgres+pgvector, redis, minio
pnpm db:migrate && pnpm db:seed # demo user: demo@tenderpilot.sa / Demo@12345
pnpm worker                     # terminal 1 — Scout + scoring workers, 6-hourly sweep
pnpm dev                        # terminal 2 — http://localhost:3000 (→ /ar)
```

Sign in, then press **Run Scout now** on the dashboard. The Scout ingests tenders from
the mock Etimad feed, the scoring worker scores them, and the dashboard refreshes.

Without a worker: `pnpm scout:run` runs ingestion + scoring inline.
Without any infrastructure: `pnpm --filter @tenderpilot/core demo [--lang ar]`.

## Scripts

| Command | |
| --- | --- |
| `pnpm typecheck` / `pnpm test` / `pnpm build` | The phase gate (Turborepo). DB integration tests run when `DATABASE_URL` is set. |
| `pnpm db:generate` | New Drizzle migration from schema changes. |
| `pnpm db:migrate` | Apply migrations + sync reference data (roles). |
| `pnpm db:seed` | Idempotent demo user, org, bidding profile and certifications. |
| `pnpm scout:run [--queue] [--org <id>]` | Run the Scout inline (default) or enqueue it. |
| `cd e2e && npm i && BASE_URL=… node acceptance.mjs` | Browser acceptance gate (both locales). |

## The scoring model

`scoreOpportunity({ tender, profile, certifications, asOf })` is pure and deterministic
(no clock, I/O or LLM). Six weighted factors produce a 0–100 score; every factor
returns `{ key, labelAr, labelEn, weight, ratio, contribution, reasonAr, reasonEn }`.

| Factor | Weight | Rule |
| --- | --- | --- |
| Sector match | 25% | Tender sector ∈ company sectors. |
| Classification eligibility | 20% | **Hard gate.** Company must hold the field at the required grade or better (grade 1 strongest). |
| Certification coverage | 20% | Share of required certifications held *and valid through the submission deadline*. |
| Value fit | 15% | 1.0 within 20–100% of max contract value; small contracts ≥ 0.6; decays to 0 at 2× capacity; undisclosed = 0.6. |
| Deadline feasibility | 10% | Linear up to 21 days of preparation time; 0 once passed. |
| Past performance | 10% | Mean rating of past projects in the sector; 0.3 baseline with none. |

A failed gate sets `disqualified` plus a bilingual reason, but every other factor is still
computed. Users can see exactly what it would take to qualify.

## Security & tenancy

- Every domain row carries `org_id`. All reads and writes go through services that take
  `orgId` from the authenticated membership, never from client input.
- tRPC: `protectedProcedure` → `orgProcedure` (tenant scope) → `requirePermission(…)` (RBAC).
- Mutations write to the append-only `audit_log` in the same transaction.
- Secrets are read only via `getServerEnv()`. `SECRETS_PROVIDER=azure-keyvault` hydrates them from Key Vault at boot.
