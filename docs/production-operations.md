# Production operations runbook

## Health and readiness

Railway checks `/api/health`. A production-ready response must contain `status=ok` and `db=postgresql`. From a private operator environment, run `HEALTHCHECK_BASE_URL=https://YOUR_API.example HEALTHCHECK_REQUIRE_POSTGRES=true python deploy/healthcheck.py`.

Never include credentials or query tokens in the health URL. A healthy process with a non-PostgreSQL database is not production-ready.

## Safe smoke test

Use a dedicated test user and the generic-form simulator only.

1. Verify Vercel `/login` and Railway `/api/health`.
2. Load public-UUID fixture jobs; do not paste a real employer application URL.
3. Confirm job match and resume ATS scores appear separately, and ATS optimization stops after at most two rounds.
4. Answer a required question and ensure the answer is not silently reused.
5. Approve the exact content snapshot and verify edits make approval stale.
6. Create a simulated queued receipt with an `Idempotency-Key`; replay it and verify the same receipt returns.
7. Send simulated accepted/succeeded callbacks and verify the append-only receipt/timeline.
8. Exercise CAPTCHA and 2FA simulator branches and verify OpenClaw stops.
9. Confirm no request reached Greenhouse, Lever, Indeed, LinkedIn, or another real recruiting host.

## Logging and redaction

Application logs may contain public application/receipt IDs, UTC timestamps, states, durations, retry counts, and structured error codes. They must not contain email, phone, address, resume/JD bodies, answers, authorization headers, tokens, cookies, callback secrets, DOM snapshots, or form payloads.

Redact at log creation. As defense in depth, operator exports can use `deploy.redact.redact`; the filter reduces accidental exposure but is not a substitute for structured allow-listed logging. Restrict Railway/Vercel/OpenClaw log access and retention, and rotate any secret immediately if it appears in a log.

Alert on sustained health failures, PostgreSQL connection exhaustion, repeated `agent.callback_unauthorized`, callback latency, idempotency conflicts, and spikes in `needs_attention`. Never put personal data into alert titles or chat notifications.

## Recovery

### Frontend failure

Roll Vercel traffic back to the last known-good deployment. The API and PostgreSQL remain authoritative, so do not reconstruct state from browser storage. Device Agent settings are intentionally non-authoritative.

### API release failure

Stop OpenClaw consumers, pause traffic, and roll Railway back to the last image compatible with the current schema. Do not roll application code behind an irreversible migration. Re-run the health probe before resuming adapters.

### Database failure or data loss

1. Stop OpenClaw and all write traffic.
2. Preserve redacted logs and note the UTC incident window.
3. Restore the latest verified provider snapshot to a new PostgreSQL instance.
4. Apply only reviewed forward migrations.
5. Point one API replica at the restored database and run read-only consistency checks.
6. Verify approval digests, receipt uniqueness, idempotency records, and callback audit events before reopening writes.
7. Rotate database credentials after the incident.

Never synthesize missing approvals or successful receipts during recovery.

### Callback-secret exposure

Pause OpenClaw, rotate `AGENT_CALLBACK_SECRET` in Railway and OpenClaw together, redeploy both, reject callbacks signed with the old secret, and review callback event IDs for replay/conflict signals.

Rollback is appropriate for regressions without incompatible data changes. Restore is appropriate only for confirmed data loss or corruption. If schema compatibility is uncertain, keep writes paused and involve the backend/data owner; do not improvise a reverse migration.
