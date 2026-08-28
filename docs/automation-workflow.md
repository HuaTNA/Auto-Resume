# Career automation workflow

The job-search automation is a safe, review-first agent workflow:

1. Read the user's Career Profile plus a broad career direction.
2. When Claude is available, plan 1–5 focused job-board queries and an explicit selection strategy.
3. Search Indeed and Adzuna across those directions while reserving result capacity for every query.
4. Deduplicate the combined pool and rank it against both the profile and the agent's plan.
5. Persist job matches and create `suggested` application records above the score threshold.
6. Optionally generate a limited number of resumes and cover letters.
7. Notify the user and wait for material approval. External job submission always remains manual.

Each run stores the agent's goal, executed queries, selection strategy, and any fallback warning. If `ANTHROPIC_API_KEY` is unavailable or planning fails, the workflow remains operational with the configured seed query and labels the run as fallback mode. `agent_enabled` and `max_search_queries` can be set in the automation config; new automations enable the agent by default with three queries.

## Scheduling

Supported schedule values are `manual`, `hourly`, `daily@09:00`, and `weekly:0@09:00` (`0` is Monday). In local SQLite development, the API automatically checks due automations every 30 seconds. Set `LOCAL_AUTOMATION_SCHEDULER=false` to disable this behavior.

For a dedicated hosted worker, or when the API's local scheduler is disabled, run:

```bash
python automation/runner.py --interval 30
```

The `worker` entry in `Procfile` runs the same process on platforms that support process types. On platforms with an HTTP scheduler, configure `CRON_SECRET` and call:

```text
POST /api/internal/automations/run-due
X-Cron-Secret: <CRON_SECRET>
```

The backend Vercel project registers this endpoint through `vercel.json` and
invokes it daily at `14:00 UTC`. Vercel sends `CRON_SECRET` as an
`Authorization: Bearer` header. This daily trigger reliably covers the default
`America/Toronto` 09:00 schedule across daylight-saving changes, although a
Hobby-plan invocation may occur later within the hour. Use the persistent worker
for hourly schedules, tighter timing, or users in multiple time zones.

## Required environment

- `ADZUNA_APP_ID`
- `ADZUNA_APP_KEY`
- `ANTHROPIC_API_KEY` for ranking and document generation
- `JWT_SECRET`
- `DATABASE_URL` for hosted persistence
- `CRON_SECRET` when using the HTTP scheduler endpoint

The workflow retries failures up to the configured limit and records the final error and attempt count. Completion, failure, material readiness, and approval events create in-app notifications.
