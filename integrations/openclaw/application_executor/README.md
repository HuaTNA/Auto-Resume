# Application executor

The browser core is an isolated execution boundary. The local `worker` connects
it to Auto-Resume's user-bound queue, approval validation, callbacks and Discord
notifications. The website remains the source of truth.

See [AGENT_4_PROMPT.md](AGENT_4_PROMPT.md) for the executor assignment and
[OPENCLAW_BROWSER_CONSTRAINTS.md](OPENCLAW_BROWSER_CONSTRAINTS.md) for the
official browser operating constraints and supported-site list.

## Safety contract

- `ApplicationExecutor.execute()` fills a supported form and stops with `ready_for_approval` by default.
- Submission requires a `queued` submission receipt plus its approved snapshot ID/content digest, accepted by the injected `SubmissionAuthorizationValidator` for the exact execution fingerprint.
- CAPTCHA, 2FA, expired login, unknown sensitive questions, missing required answers, and unexpected page structure call `on_blocker` and stop.
- A successful result requires visible confirmation text or a confirmation/reference number after the submit click.
- Adapter order is Greenhouse, Lever, then a conservative generic HTML form adapter.
- Page text and recruiting-site content are treated only as untrusted form data; they are never interpreted as executable instructions.

The executor depends only on the `BrowserPage` protocol. `PlaywrightPage` bridges a synchronous Playwright-compatible page at runtime without adding Playwright as a package dependency. Tests use an in-memory page fixture and never navigate to a real recruiting site.

```python
executor = ApplicationExecutor(
    page=PlaywrightPage(openclaw_page),
    authorization_validator=my_queued_receipt_validator,
    on_blocker=publish_blocker,
)
result = executor.execute(request)
```

The request authorization is assembled from the API's queued receipt and
`agent.latest_approval`. A successful or failed authorized execution returns an
idempotent `SubmissionCallback` payload for
`POST /api/internal/agent/submission-callbacks`; this layer does not send the
callback automatically. `AutoResumeCallbackClient` can publish it through an
injected transport using the frozen Agent 1 callback envelope. Receipt
creation, approval persistence, quota charging, idempotency, and callback
authentication stay in Auto-Resume.

## Environment

- `AUTO_RESUME_API_URL`
- `AUTO_RESUME_SERVICE_TOKEN` (secret; never log)
- `AUTO_RESUME_WEBHOOK_SECRET` (secret; never log)
- `OPENCLAW_GATEWAY_URL`
- `OPENCLAW_GATEWAY_TOKEN` (secret; never log)
- `APPLICATION_ALLOWED_DOMAINS` (comma-separated exact domains or parent domains)
- `APPLICATION_DRY_RUN=true` (safe default and mandatory in every automated test)

`APPLICATION_DRY_RUN=true` permits the final simulated click only for local
`*.mock-ats.test` pages. All other hosts remain fill-only/blocked even if they
appear in the allowlist.

At deployment, `AUTO_RESUME_WEBHOOK_SECRET` in the OpenClaw worker must contain
the same secret value as Agent 1's server-side `AGENT_CALLBACK_SECRET`; the
different variable names are process-local and do not change the HTTP contract.

## Run the connected worker

From the repository root, with the existing application virtualenv:

```sh
.venv/bin/python -m pip install -r integrations/openclaw/application_executor/requirements.txt
.venv/bin/python -m playwright install chromium
.venv/bin/python -m integrations.openclaw.application_executor.worker --check --discord-user-id YOUR_NUMERIC_ID
.venv/bin/python -m integrations.openclaw.application_executor.install_service --discord-user-id YOUR_NUMERIC_ID --discord-channel-id YOUR_CHANNEL_ID
```

The installer starts a macOS LaunchAgent in **safe mode**. It polls every 20
seconds, announces website/material updates, publishes pending callbacks and
reports its heartbeat. It does not claim real queued applications, fill forms
or launch a recruiting-site browser. Mock-only test allowlists can exercise
the entire simulated loop. Secrets are loaded from `~/.openclaw/.env`, never
embedded in the LaunchAgent. The machine must be awake and logged in.

Before live use, stop the safe service, review the exact queued jobs and domain
allowlist, then explicitly start the worker with `--loop --live` and the same
user/channel arguments. Do not run two workers simultaneously. Live use still
requires a current approved snapshot and an explicitly queued receipt for each
job. Default domains are `boards.greenhouse.io`, `job-boards.greenhouse.io`,
`jobs.lever.co`; unsupported sites require manual handling. A dedicated local
Chromium profile is used, not your personal browser session.

```sh
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/ai.auto-resume.executor.plist
```

Callback/notification outbox and protected logs are under
`~/.openclaw/auto-resume-executor/`. A delivery failure retries only the saved
result, not the application. Discord notifications are at-least-once. A crash
after claiming a receipt leaves it `accepted`; reconcile the employer page
manually before retrying. There is intentionally no automatic lease expiry or
re-submission after an uncertain click. CAPTCHA, login, sensitive/unanswered
questions and unverified confirmations stop execution. No success is inferred
from clicking Submit alone.
