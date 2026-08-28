# Application Agent Platform Contract (v1)

Status: frozen for v1. Additive fields and endpoints are allowed; existing enum
values, meanings, idempotency scope, and error codes are not to be renamed.

This document and `api/schemas/agent.py` are the shared source of truth. The
Pydantic field constraints are authoritative if prose is ambiguous.

## Safety boundary

The API owns user identity, application state, answers, approval snapshots,
quota charging, idempotency, and receipts. Browser/OpenClaw adapters may perform
an external submission only after `POST /api/agent/applications/{id}/submissions`
returns a queued receipt. They must report outcomes through the authenticated
internal callback. A callback alone never grants permission to submit.

Every external submission requires all three guards:

1. A current `approved` approval whose `content_digest` matches the resume,
   cover letter, and application answers at submission time.
2. Available persistent per-user external API/submission quota.
3. A non-empty `Idempotency-Key`, scoped to the authenticated user. Reusing a
   key with the same canonical request returns the original receipt; reuse with
   different content returns `409 agent.idempotency_conflict`.

Recommendation-batch creation, material generation, and submission creation
require `Idempotency-Key` (1–128 characters). Other state writes use the
Agent's optimistic `expected_version` where the schema exposes it. Internal
callbacks additionally require globally unique `event_id`. No response exposes
database integer IDs. Times are UTC ISO 8601 strings.

## States

Application Agent states are:

`discovered -> preparing -> awaiting_answers -> awaiting_approval -> approved -> submitting -> submitted`

Terminal/side states are `rejected`, `failed`, and `withdrawn`.
`needs_attention` means adapter or answer intervention is required and may be
retried. State writes use `expected_version`; stale writers receive HTTP 409.

Allowed user actions:

| Current state | Action | Next state |
| --- | --- | --- |
| discovered | start | preparing |
| preparing | request_answers | awaiting_answers |
| preparing, awaiting_answers, needs_attention | request_approval | awaiting_approval |
| failed, needs_attention | retry | preparing |
| any non-terminal state except submitting | withdraw | withdrawn |

Approval decisions move `awaiting_approval` to `approved` or `rejected`.
Creating a submission moves `approved` to `submitting`. A `succeeded` callback
moves it to `submitted`; a `failed` callback moves it to `needs_attention`.
Callbacks with `queued` or `accepted` retain `submitting`.

## Resources and API

All public IDs are opaque strings. All user endpoints are authenticated and
user-scoped.

- `POST /api/agent/recommendation-batches` — requires `Idempotency-Key`; freezes
  an ordered set of existing career jobs and ensures one application/agent per
  job. Scheduled ranked searches create a batch for up to three actionable
  jobs. `GET /api/agent/recommendation-batches/latest` returns the newest ready
  batch and `GET /api/agent/recommendation-batches/{id}` returns one exact batch.
- `GET /api/agent/applications/{id}` — accepts an Agent or CareerApplication ID
  and returns agent state, version, job, answers, latest approval, and latest
  receipt. During the v1 client migration the payload is available both at the
  top level and under `agent`; the nested object is canonical.
- `POST /api/agent/applications/{id}/transitions` — applies a state action with
  optimistic concurrency.
- `GET|POST /api/agent/answers` and `PATCH /api/agent/answers/{id}` — manages the
  reusable answer library. `question_key` is unique per user.
- `PUT /api/agent/applications/{id}/answers/{question_key}` — upserts a bound
  application answer. Any edit after approval makes that approval stale because
  the content digest changes.
- The `request_approval` transition atomically creates a pending approval for
  the current content snapshot. `POST /api/agent/applications/{id}/approvals`
  refreshes/supersedes a pending snapshot. `POST /api/agent/approvals/{id}/decision`
  records the human decision; `expected_version` is the Agent version.
- `POST /api/agent/applications/{id}/submissions` — requires an approved,
  digest-matching snapshot, quota, and `Idempotency-Key`; returns HTTP 202 and a
  queued receipt for an adapter to consume.
- `POST /api/internal/agent/submission-callbacks` — requires
  `X-Internal-Callback-Secret` matching `AGENT_CALLBACK_SECRET`. `event_id` is
  globally idempotent. Identical replay returns the original result; a changed
  replay returns HTTP 409.

The complete v1 surface is:

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/agent/recommendation-batches` | Freeze ranked recommendations |
| GET | `/api/agent/recommendation-batches/latest` | Read newest ready batch |
| GET | `/api/agent/recommendation-batches/{id}` | Read a recommendation batch |
| GET | `/api/agent/applications/{id}` | Read the Agent aggregate |
| POST | `/api/agent/applications/{id}/transitions` | Versioned state action |
| GET | `/api/agent/answers` | List reusable answers |
| POST | `/api/agent/answers` | Create a reusable answer |
| PATCH | `/api/agent/answers/{id}` | Update a reusable answer |
| PUT | `/api/agent/applications/{id}/answers/{question_key}` | Save one application answer |
| POST | `/api/agent/applications/{id}/materials` | Generate bounded materials idempotently |
| POST | `/api/agent/applications/{id}/approvals` | Refresh an approval snapshot |
| POST | `/api/agent/approvals/{id}/decision` | Approve/reject a snapshot |
| POST | `/api/agent/applications/{id}/submissions` | Authorize and queue submission |
| POST | `/api/internal/agent/submission-callbacks` | Submission result callback |

## Status values

- Recommendation batch: `ready` (v1 creation is synchronous), `failed`,
  `expired`.
- Approval: `pending`, `approved`, `rejected`, `superseded`.
- Submission receipt: `queued`, `accepted`, `succeeded`, `failed`.
- Answers: application answers carry `required`; an empty required answer is
  invalid. Library entries carry `reusable` and are never silently applied to a
  submission.

## Error envelope

Domain failures use FastAPI's envelope with a structured detail:

```json
{
  "detail": {
    "code": "agent.approval_required",
    "message": "A current human approval is required before submission.",
    "retryable": false,
    "context": {}
  }
}
```

Frozen codes: `agent.not_found`, `agent.idempotency_required`,
`agent.idempotency_conflict`, `agent.invalid_state_transition`,
`agent.answers_incomplete`, `agent.materials_required`,
`agent.material_generation_failed`, `agent.material_budget_exceeded`,
`agent.approval_required`, `agent.approval_stale`,
`agent.submission_limit_reached`, `agent.callback_unauthorized`,
`agent.callback_conflict`, `agent.dispatch_unavailable`,
`agent.human_intervention_required`, `agent.submission_unverified`, and
`agent.validation_failed`.

HTTP mapping: validation 400/422, authentication 401, not found 404,
state/idempotency/digest conflicts 409, quota 429, and accepted submission 202.

## Canonicalization and retention

Request hashes and content digests are SHA-256 over UTF-8 canonical JSON
(`sort_keys=true`, compact separators). Secrets and raw adapter credentials are
never stored in callback metadata. Receipts and approvals are append-only audit
records; callback events retain their payload hash and sanitized payload.

## Agent 2 material service contract

The sole supported callable is:

```python
from src.material_pipeline import run_material_pipeline

result = run_material_pipeline(...)  # -> MaterialPipelineResult
```

`MaterialPipelineResult` and `MATERIAL_PIPELINE_RESULT_SCHEMA` in
`src/material_pipeline_contract.py` are authoritative. Agent 1 must not import
`_run_material_pipeline`, optimizer, or scorer internals. The result keeps
`job_match` separate from `resume_ats` and includes `material`, `versions`,
`optimization`, `usage`, `warnings`, and `errors`.

`POST /api/agent/applications/{id}/materials` accepts
`MaterialGenerationRequest`, invokes the public pipeline synchronously, persists
the selected resume, ATS result, optimization summary, usage, warnings, and
errors, then returns the canonical Agent aggregate. Replaying after materials
exist returns the same persisted result without another model run.

Material invariants:

- Profile and JD text are untrusted data, not instructions.
- Unsupported candidate facts are rejected before ATS scoring.
- Maximum two optimization rounds, 11 model calls, 120000 estimated input
  tokens, and 23700 reserved output tokens.
- A regression never replaces the best grounded version.
- Tests use the three fixtures under `tests/fixtures/material_pipeline/`:
  `success.json`, `ats_not_met.json`, and `ai_failure.json`.
- Agent 2 never writes business state directly; Auto-Resume persists results.

## Agent 3 and Agent 4 internal contract

The Discord bridge uses `AUTO_RESUME_SERVICE_TOKEN` plus trusted
`X-Discord-User-Id`, `X-Discord-Channel-Id`, and `X-Discord-Message-Id` headers.
The Discord User ID must be connected to exactly one Auto-Resume user through
provider `discord`; the token alone cannot select a user. Browser-result
callbacks require `X-Internal-Callback-Secret` matching `AGENT_CALLBACK_SECRET`.
Secrets are never placed in JSON, URLs, logs, tests, or fixtures.

- Agent 3 reads the latest/exact recommendation batch, applies the versioned
  `start` transition, invokes bounded material generation, then requests human
  approval through the public Agent API.
- Agent 4 posts `SubmissionCallback` with `accepted`, `succeeded`, or `failed`.
  A success needs verified confirmation metadata. Ambiguous confirmation uses
  `failed` plus `error_code=submission_unverified`.

Agent 4 may fill a form without a submission authorization, but it must not
click the final submit control without a valid queued `SubmissionDispatch`.
CAPTCHA and 2FA are never bypassed. Only Greenhouse, Lever, and local simulated
generic forms are in MVP scope; tests never submit to a real job.

## Agent 5 frontend fixtures

Use fake `.test` URLs and these canonical JSON shapes.

Recommendation batch:

```json
{
  "id": "0f40cf8a-26cd-42dc-a672-4a436d235a40",
  "label": "Top roles",
  "status": "ready",
  "items": [{
    "id": "0d1443d8-7cc7-4307-a5e2-b246d2a4d696",
    "position": 0,
    "job": {
      "id": "10c0e276-6930-476a-b95b-19b680426c13",
      "title": "Platform Engineer",
      "company": "Example Robotics",
      "location": "Toronto",
      "source": "fixture",
      "source_url": "https://jobs.example.test/platform-engineer"
    },
    "application_id": "b70c192a-3f6b-47fa-a3a5-e3353bb83244",
    "agent_id": "6cf1ad1b-2ed4-43f1-917c-850530572f02",
    "agent_state": "discovered"
  }],
  "created_at": "2026-08-27T16:00:00Z",
  "updated_at": "2026-08-27T16:00:00Z"
}
```

Agent aggregate:

```json
{
  "agent": {
    "id": "6cf1ad1b-2ed4-43f1-917c-850530572f02",
    "application_id": "b70c192a-3f6b-47fa-a3a5-e3353bb83244",
    "state": "awaiting_approval",
    "version": 3,
    "match_score": 87,
    "ats_score": 84,
    "ats_rounds": 1,
    "job": {
      "id": "10c0e276-6930-476a-b95b-19b680426c13",
      "title": "Platform Engineer",
      "company": "Example Robotics",
      "location": "Toronto",
      "provider": "greenhouse"
    },
    "answers": [{
      "id": "3329fcbd-c55e-42bb-8172-2d5b33e938b9",
      "question_key": "work.authorization",
      "question": "Are you authorized to work in Canada?",
      "answer": "Yes",
      "required": true,
      "source": "user"
    }],
    "latest_approval": {
      "id": "e0aed062-b628-4716-afd1-66328932051e",
      "status": "pending",
      "content_digest": "4a9ec98ae20a17d0ecdb03ccdd4c3a40c6f4a08d9e466f90da2d6ca9cfbcd9e1",
      "version": 1,
      "created_at": "2026-08-27T16:02:00Z"
    },
    "latest_receipt": null,
    "timeline": [],
    "updated_at": "2026-08-27T16:02:00Z"
  }
}
```

Queued receipt:

```json
{
  "id": "2b814571-901f-48b1-953b-e150365023df",
  "provider": "greenhouse",
  "status": "queued",
  "external_application_id": null,
  "error_code": null,
  "error_message": null,
  "metadata": {},
  "created_at": "2026-08-27T16:03:00Z",
  "updated_at": "2026-08-27T16:03:00Z",
  "completed_at": null
}
```
