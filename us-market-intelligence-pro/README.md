# US Market Intelligence Pro

Telegram platform for US-market analysis, trade-idea signals (signals & simulation only — **no order
execution**), Telegram Stars subscriptions and private-channel membership.

> ⚠️ **Not cleared for commercial launch.** Paid trading signals to Saudi users very likely need a
> CMA licence — see [docs/COMPLIANCE_CHECKLIST.md](docs/COMPLIANCE_CHECKLIST.md).

Docs (Arabic): [PLAN](docs/PLAN.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) ·
[SECURITY](docs/SECURITY.md) · [DATA_SOURCES](docs/DATA_SOURCES.md) ·
[COMPLIANCE](docs/COMPLIANCE_CHECKLIST.md) · [ROADMAP](docs/ROADMAP.md) ·
**[STATUS — what works, what doesn't, evidence](docs/STATUS.md)**

## Run locally

```bash
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
cp .env.example .env            # fill in values; never commit .env

# tests (SQLite)
.venv/bin/pytest -q
# tests on PostgreSQL
UMIP_TEST_DATABASE_URL=postgresql+asyncpg://user:pass@localhost/umip_test .venv/bin/pytest -q

# database
UMIP_DATABASE_URL=postgresql+asyncpg://user:pass@localhost/umip .venv/bin/alembic upgrade head
.venv/bin/python -m umip.main seed          # default plans (placeholder prices!)

# admin API + webhook endpoint
.venv/bin/python -m umip.main api           # http://127.0.0.1:8000/health
# or: bot via long polling + background jobs (needs UMIP_TELEGRAM_BOT_TOKEN, test env by default)
.venv/bin/python -m umip.main polling
```

Docker: `docker compose up --build` (needs `.env` with `POSTGRES_PASSWORD`). Put the API behind an
HTTPS reverse proxy and register the webhook with `secret_token = UMIP_TELEGRAM_WEBHOOK_SECRET`.

Admin API (header `X-API-Key`): `GET /admin/stats`, `GET /admin/signals?status=validated`,
`POST /admin/signals/{ref}/decision {"approve": true}`, `GET /admin/signals/{ref}/history`,
`POST /admin/kill-switch {"on": true}`, `GET /admin/performance?kind=paper`,
`GET|PATCH /admin/plans`, `GET /admin/payments`, `GET /admin/audit`.
