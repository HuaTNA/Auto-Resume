# Staging acceptance checklist

This checklist is staging-ready guidance only. It does not authorize creating cloud resources, sending Discord messages, or submitting any real job application.

## Release identity

- [ ] Record the exact Git commit, Vercel preview deployment, Railway staging deployment, PostgreSQL backup ID, and OpenClaw build.
- [ ] Confirm staging uses separate credentials, database, cookie domain, callback secret, Discord test server/channel, and quotas.
- [ ] Confirm no Service Token, OpenClaw token, Discord token, password, or cookie is present in a `NEXT_PUBLIC_*` variable or client bundle.
- [ ] Confirm `AGENT_MOCK_API` and `NEXT_PUBLIC_AGENT_API_BASE` are unset outside local/E2E environments.

## Automated gates

- [ ] Backend unit tests and Python compilation pass.
- [ ] Frontend lint, Hua UI guard, TypeScript, and production build pass.
- [ ] Mobile Playwright tests pass with no request to a real recruiting host.
- [ ] Deployment JSON and redaction tests pass.
- [ ] Dependency/security findings are reviewed; no unresolved critical finding is promoted.

## Data and state

- [ ] All client-visible IDs are public UUIDs and timestamps are UTC ISO 8601.
- [ ] Auto-Resume remains the only source of truth; OpenClaw and browser storage can be discarded without losing business state.
- [ ] Job match and resume ATS scores are shown separately.
- [ ] Material pipeline reports status, stop reason, usage, warnings/errors, and never exceeds two ATS rounds.
- [ ] Generated materials contain no unsupported candidate facts.
- [ ] Every write is sent with an `Idempotency-Key`; conflict and replay behavior are verified.

## Mobile and Discord workflow

- [ ] Mobile layout works at 390×844 CSS pixels with keyboard navigation and 44px-class touch targets.
- [ ] Required answers can be supplied without silent reuse from the answer library.
- [ ] Discord choices map to the same public Agent/application IDs and states shown on mobile.
- [ ] The bridge service token is configured on both services, and the staging Discord User ID is connected to exactly one Auto-Resume account through provider `discord`.
- [ ] Approval requires the current optimistic version and content digest.
- [ ] The confirm panel visibly shows company/role, resume version, ATS score, all answers, and final application domain.
- [ ] A missing snapshot field disables confirmation.

## Execution safety

- [ ] Only Greenhouse, Lever, and the isolated generic simulator adapters are enabled.
- [ ] The generic simulator uses only `*.example.test` or an equivalent controlled local host.
- [ ] OpenClaw stops on CAPTCHA, 2FA, expired authentication, sensitive questions, unsupported sites, and unverifiable submissions.
- [ ] No adapter acts without a queued receipt for the approved digest.
- [ ] Simulated callback progression is append-only and ends with a stored receipt/audit event.
- [ ] Logs and alerts reveal no email, phone, address, token, cookie, answer, resume/JD body, DOM, or form payload.

## Staging sign-off

- [ ] Product owner reviews the full simulator recording and receipt.
- [ ] Backend/data owner confirms schema compatibility and backup/restore evidence.
- [ ] OpenClaw owner confirms dry-run and domain allow-list evidence.
- [ ] Release owner confirms rollback target and pauses live enablement. Staging acceptance does not enable real submissions.

## Rollback rehearsal

1. Pause OpenClaw consumers and API writes.
2. Roll Vercel staging to the recorded previous deployment.
3. Roll Railway to the previous schema-compatible image.
4. If data was corrupted, restore the recorded staging snapshot into a new database; never overwrite the only copy.
5. Run `/api/health`, read-only consistency checks, and the simulator smoke test.
6. Verify approval digests, receipt uniqueness, idempotency replays, and callback audit order.
7. Resume adapters only after all checks pass; rotate secrets if exposure triggered rollback.

Production rollback details are in `docs/production-operations.md`.
