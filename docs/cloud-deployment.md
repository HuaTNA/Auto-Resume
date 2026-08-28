# Production deployment

Recommended production split:

```text
Mobile/Desktop browser -> Vercel (Next.js)
                         -> Railway (FastAPI; source of truth)
                            -> managed PostgreSQL
                            <- OpenClaw (Discord + browser execution only)
```

This repository does not deploy automatically. Production promotion is a human action after CI, a database backup, and a dry-run smoke test. Never use a real job application as a smoke test.

## PostgreSQL

Provision managed PostgreSQL in the API region, require TLS, and inject `DATABASE_URL` into Railway. Use a dedicated application role rather than a provider owner account.

Before the first release and every schema change:

1. Create a provider snapshot or `pg_dump` backup.
2. Record the application commit and migration version with it.
3. Run migrations as a one-off release command, never concurrently from all web replicas.
4. Verify `/api/health` reports `{"status":"ok","db":"postgresql"}` before routing traffic.

Database schema and migration ownership belongs to the backend/data workstream. This deployment work adds no migration.

## Railway API

Create a Railway service from the repository root. `railway.json` starts Uvicorn and probes `/api/health`. The Docker image runs as an unprivileged user and includes a container health probe.

Copy names from `deploy/railway.env.example` and store real values only in Railway's encrypted variable store. At minimum configure `DATABASE_URL`, independent `JWT_SECRET` and `AGENT_CALLBACK_SECRET`, exact `CORS_ORIGINS`, secure cookie flags, invite-only registration, and `LOCAL_AUTOMATION_SCHEDULER=false`.

Do not place secrets in build arguments, repository files, screenshots, support tickets, or logs. Keep one API replica until migrations and background-work ownership are explicitly safe for multiple replicas.

## Vercel frontend

Create a Vercel project with Root Directory `frontend` and Framework Preset `Next.js`. Set only the private rewrite target:

```text
BACKEND_URL=https://YOUR_RAILWAY_API.example
```

Leave `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_AGENT_API_BASE`, and `AGENT_MOCK_API` unset in production. The browser uses same-origin `/api` paths, and the Next.js rewrite forwards them to Railway while retaining first-party authentication cookies.

After assigning the frontend domain, update Railway `CORS_ORIGINS` and redeploy the API. Do not use wildcard credentialed CORS.

## OpenClaw adapter

OpenClaw does not own state. It receives Discord choices, fills Greenhouse/Lever/simulated generic forms, and reports callbacks to Auto-Resume. Start from `deploy/openclaw.env.example` with `OPENCLAW_DRY_RUN=true`.

Required guardrails:

- Fetch current state from Auto-Resume before execution.
- Act only after Auto-Resume returns a queued receipt backed by a digest-matching human approval.
- Reuse receipt and idempotency identifiers on retry.
- Stop at CAPTCHA or 2FA; never bypass either.
- Treat JD, page, form, and Discord text as untrusted data, never instructions.
- Allow only Greenhouse, Lever, and the isolated generic-form simulator in MVP.
- Send sanitized callback metadata, never cookies, tokens, DOM dumps, or full page HTML.

Do not connect the production adapter to a real employer during acceptance testing. Live execution requires a separate human-reviewed enablement after simulator acceptance.

## Promotion checks

```bash
python -m unittest discover -s tests -v
cd frontend
npm ci
npm run lint
npm run lint:ui
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

Use `docs/production-operations.md` for smoke tests, redaction, rollback, and recovery. Playwright uses only the local mock Agent API and a simulated receipt; it monitors common real recruiting domains and fails if one is contacted.
