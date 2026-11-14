# UMIP admin dashboard

Next.js 16 (App Router) + TypeScript + Tailwind 4. Arabic (RTL, default) and English, light/dark/system.

**Architecture: backend-for-frontend.** The browser never sees the admin API key. On sign-in the key is
validated against `GET /admin/me`, then sealed (JWE, A256GCM) into an `httpOnly; SameSite=Strict` cookie.
Server Components read data and Server Actions perform mutations, attaching the key server-side. Roles
(support < analyst < admin) are enforced by page guards and again by the backend.

| Page | Role | What it does |
|------|------|--------------|
| Overview | support | KPIs (active subscribers, net revenue, recurring MRR, churn, conversion, ARPU), daily charts, alerts, signal pipeline, coupon results |
| Signals | analyst | Review queue, approve & publish / reject, detail with price ladder, option contract and history, tracking with net R, manual signal form with live geometry and R:R checks |
| Performance | analyst | Published / paper / backtest kept strictly apart; expectancy, win rate, PF, drawdown, cumulative R, breakdowns by strategy, symbol, session |
| Subscribers | support | Search and filter, detail with periods, payments, channel membership; admin: block, complimentary access |
| Payments | admin | Stars transactions; refund via Telegram with typed confirmation |
| Plans & coupons | admin | Prices (with Telegram's recurring cap), names, AI quotas; coupon creation and toggling |
| System | support (controls: admin) | Kill switch with typed confirmation, publish mode, strategy toggles, integrations, outbox and dead letters with retry |
| Audit log | admin | Filterable, append-only |

## Run

```bash
cp .env.example .env.local          # UMIP_API_URL, SESSION_SECRET (32+ chars)
npm ci
npm run dev                          # http://localhost:3000
```

Demo data (local only): from the project root, `UMIP_DATABASE_URL=... python -m scripts.seed_demo`, then
start the API with keys, e.g. `UMIP_ADMIN_API_KEYS='{"demo-admin-key-0001":"admin","demo-analyst-key-0002":"analyst","demo-support-key-0003":"support"}'`.

## Checks

```bash
npm run typecheck && npm run lint && npm test      # tsc, eslint, vitest
npm run build                                       # production build
npm run e2e                                         # Playwright; needs API + dashboard running with demo data
# PW_CHROMIUM=/path/to/chrome and E2E_BASE_URL=... override the browser and target
```
