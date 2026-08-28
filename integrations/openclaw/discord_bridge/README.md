# Auto-Resume OpenClaw Discord Bridge

This package is the Discord/OpenClaw execution boundary for Application Agent Contract V1. It calls Auto-Resume only through HTTP and never imports `api.database`, ORM models, or workflow internals. It does not submit applications, bypass CAPTCHA/2FA, or change state outside the published API.

## Contract boundary

The source of truth is [`docs/agent-platform-contract.md`](../../../docs/agent-platform-contract.md) and [`api/schemas/agent.py`](../../../api/schemas/agent.py). The client uses only:

- `GET /api/agent/recommendation-batches/latest`
- `GET /api/agent/recommendation-batches/{id}`
- `GET /api/agent/applications/{id}`
- `POST /api/agent/applications/{id}/transitions`
- `POST /api/agent/applications/{id}/materials`
- `POST /api/agent/approvals/{id}/decision`

Every request carries the originating Discord message ID and a deterministic `Idempotency-Key`. Every write body and response uses Contract V1 enum values and optimistic versions. No database ID is accepted; command resource IDs must be public UUIDs.

Contract V1 has no direct `GET approval` endpoint. Therefore:

- The signed-in user first connects provider `discord` through `PUT /api/integrations/discord`, storing only their Discord User ID in `external_account`. The API then accepts the bridge service token only when the trusted `X-Discord-*` headers resolve to exactly one connected user. “绑定” additionally validates OpenClaw's trusted User/Channel context against deployment allowlists. Guild access stays on the OpenClaw Discord channel because the typed-tool SDK does not expose guild ID.
- Approval status requires both approval ID and agent ID, then checks that `agent.latest_approval.id` equals the requested approval ID.
- The service token is a bridge credential, not a user selector. Requests with an unbound, malformed, or ambiguously bound Discord identity are rejected.

## Environment variables

Set names only in config or a Secret Store; never paste values into a Discord message, prompt, repository file, test fixture, or log.

| Variable | Used by | Purpose |
|---|---|---|
| `AUTO_RESUME_API_URL` | this plugin | Auto-Resume API base URL |
| `AUTO_RESUME_SERVICE_TOKEN` | this plugin | user-scoped service credential; Secret Store/environment only |
| `DISCORD_ALLOWED_USER_IDS` | this plugin | comma-separated Discord snowflake allowlist |
| `DISCORD_ALLOWED_GUILD_IDS` | OpenClaw Discord channel | guild allowlist; not exposed to plugin tool context |
| `DISCORD_ALLOWED_CHANNEL_IDS` | this plugin | comma-separated channel allowlist |
| `DISCORD_BOT_TOKEN` | OpenClaw Discord channel | bot credential; not read by this plugin |
| `AUTO_RESUME_WEBHOOK_SECRET` | reserved | future signed webhook/callback verification; not used in V1 bridge |

Real User/Guild/Channel IDs are deployment inputs. Tests use obviously synthetic snowflakes.

Before enabling the bridge, the signed-in Auto-Resume user connects their Discord identity without storing any Discord credential:

```http
PUT /api/integrations/discord
Content-Type: application/json

{"state":"connected","external_account":"123456789012345678","scopes":["agent:read","agent:write"],"config":{}}
```

## Install and configure

Requirements: Node.js 22.22.3+ and OpenClaw 2026.5.17+.

```sh
cd integrations/openclaw/discord_bridge
npm install
npm test
npm run plugin:build
npm run plugin:validate
openclaw plugins install .
```

Configure the plugin in OpenClaw using environment substitution; do not put literal secrets in `openclaw.json`:

```json5
{
  plugins: {
    entries: {
      "auto-resume-discord-bridge": {
        enabled: true,
        config: {
          baseUrl: "${AUTO_RESUME_API_URL}",
          serviceToken: "${AUTO_RESUME_SERVICE_TOKEN}",
          allowedUserIds: "${DISCORD_ALLOWED_USER_IDS}",
          allowedChannelIds: "${DISCORD_ALLOWED_CHANNEL_IDS}"
        }
      }
    }
  }
}
```

Configure `DISCORD_BOT_TOKEN` and `DISCORD_ALLOWED_GUILD_IDS` only on OpenClaw's Discord channel credential/access-control surface. The bot token is never a tool parameter. Use per-sender Discord sessions and allowlist the three mutating optional tools (`auto_resume_bind_discord`, `auto_resume_select_recommendation`, and `auto_resume_decide_approval`) only for trusted requesters.

## Chinese commands

All commands name one concrete digest or approval. OpenClaw injects User and Channel IDs through trusted tool-factory context, not model arguments. The originating Discord message ID remains a required tool argument because the current SDK tool context does not expose it; the Discord command prompt must copy the inbound event ID exactly and never invent a replacement.

```text
绑定 <approval UUID>
推荐 [最新|digest UUID]
选择 <digest UUID> <A|B|C>
批准 <approval UUID> <agent UUID> <agent version> [备注]
拒绝 <approval UUID> <agent UUID> <agent version> [备注]
状态 digest <digest UUID>
状态 approval <approval UUID> <agent UUID>
```

A/B/C are the first, second, and third items in the contract's frozen ordered recommendation batch. Selecting one performs `GET batch → GET agent → POST start transition → POST materials → POST request_approval`; material generation is idempotent and capped at two ATS optimization rounds. Approval commands use the current Agent version, never create a submission receipt, and cannot submit externally.

## Discord input → API call test matrix

| Discord input | API calls | Assertions |
|---|---|---|
| `推荐` | `GET recommendation-batches/latest` | render newest ready ordered A/B/C |
| `推荐 <digest>` | `GET recommendation-batches/{digest}` | response ID equals digest; render ordered A/B/C |
| `选择 <digest> A` | `GET batch`, `GET agent`, `POST start`, `POST materials`, `POST request_approval` | current Agent versions; at most two ATS rounds |
| `批准 <approval> <agent> 3` | `GET applications/{agent}`, then `POST approvals/{approval}/decision` | latest approval matches; `decision=approved`, `expected_version=3` |
| `拒绝 <approval> <agent> 3` | same GET + decision endpoint | `decision=rejected`, no submission call |
| `状态 digest <digest>` | `GET recommendation-batches/{digest}` | status and target ID match |
| `状态 approval <approval> <agent>` | `GET applications/{agent}` | `latest_approval.id` must equal approval |
| any command from non-allowlisted tuple | none | reject before HTTP |
| repeated same Discord message | same calls and same `Idempotency-Key` | server can replay without duplicate writes |

`npm test` starts a loopback mock HTTP server. It makes no deployment, Discord, database, browser, or recruiting-site connection.

## Agent 3 handoff

The browser executor must consume only a queued submission receipt created by Auto-Resume after a current human approval. This Discord bridge intentionally stops at recommendation selection and approval decision. It does not call submission or callback endpoints and does not pass page/JD text to tools as instructions.
