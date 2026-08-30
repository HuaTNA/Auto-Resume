# OpenClaw integration

Versioned OpenClaw assets for the Auto-Resume platform. The skill lives here so
it is code-reviewed with the API it depends on; install it into OpenClaw by
symlinking (updates flow automatically on `git pull`):

```bash
ln -s "$(pwd)/openclaw/skills/auto-resume" ~/.openclaw/workspace/skills/auto-resume
```

## Setup

1. Issue an agent token (90-day, scope=agent):

   ```bash
   python scripts/issue_agent_token.py --email <your-email> --days 90
   ```

   Run it with `.env` containing the same `JWT_SECRET` (and `DATABASE_URL`) as
   the deployed backend.

2. Configure the skill's environment in OpenClaw (`openclaw.json` skill env, not
   inside SKILL.md):
   - `AUTO_RESUME_API_URL` — the deployed FastAPI base URL (Railway/Cloud Run,
     not the Vercel frontend)
   - `AUTO_RESUME_TOKEN` — the token from step 1

3. Verify: `openclaw skills list` should show `auto-resume`; then in chat, ask
   the agent to run the platform health check.

## Scheduled job search digest

Trigger the platform's due automations on a schedule and announce to Discord
(`--command` payload = no model tokens spent):

```bash
openclaw automations create --cron "0 9 * * *" \
  --name "daily-job-search" \
  --command "curl -s -X POST $AUTO_RESUME_API_URL/api/internal/automations/run-due -H \"X-Cron-Secret: $CRON_SECRET\"" \
  --announce --channel discord --to "<channel-id>"
```

## Security notes

- The agent token has full account access until route-level scope gating lands;
  treat it like a password. Revoke by rotating `JWT_SECRET` (invalidates all
  sessions) if it leaks.
- External job submission stays manual — the skill enforces this; don't remove
  that rule casually.
