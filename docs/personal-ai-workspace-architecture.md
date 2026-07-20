# Personal AI Workspace — Product and Migration Architecture

## Product position

`桦 / Hua` is a user-centered Personal AI Workspace. Career is the first mature business workspace, not the platform shell. The product is designed to add independent workspaces such as Learning, Content, Finance, or Health without changing the global navigation or core data contract.

The platform has four horizontal layers:

1. **Command layer** — Home, global search, command palette, notifications, quick create.
2. **Workspace modules** — Career, Projects, Tasks, Knowledge, Documents, and future modules.
3. **Intelligence and operations** — AI Copilot, Automations, Integrations, activity history.
4. **Platform services** — Auth, PostgreSQL, Storage, background jobs, scheduler, model gateway, and permissions.

## Information architecture

| Area | Purpose | Primary entities |
| --- | --- | --- |
| Home | Cross-workspace attention and continuation | tasks, projects, activities, suggestions, runs |
| Career | Jobs, matching, applications, documents, interviews | jobs, job_matches, applications, resume_versions, cover_letters |
| Projects | Durable context for an outcome | projects, milestones, tasks, notes, links, files |
| Tasks | One action layer across every module | tasks, relations, tags, due dates |
| Knowledge | Reusable notes, research, and sources | knowledge_items, topics, tags, sources |
| Documents | Generated and uploaded artifacts | documents, document_versions, storage_objects |
| Automations | Scheduled and repeatable workflows | automations, automation_runs, run_events |
| Integrations | Per-user external connections | integrations, credentials, sync_states |
| AI Copilot | Workspace-aware reasoning and confirmed actions | conversations, messages, tool_calls, approvals |
| Settings | Account, preferences, permissions, and data | users, workspace_preferences, permissions |

### Global navigation

```text
Home
Career
  Overview
  Jobs
  Applications
  Resume Studio
  Interview Prep
  Career Profile
Projects
Tasks
Knowledge
Documents
Automations
Integrations
AI Copilot
Settings
```

Navigation is declared in a module registry rather than hard-coded separately in each surface. Each module owns a stable id, route, bilingual label, icon, description, keywords, and future permission key. Desktop supports an expanded Career workspace; mobile exposes the five highest-frequency destinations. `⌘/Ctrl + K` searches the same registry.

## Frontend foundation

The current frontend separates four concerns:

- `module-registry.ts` is the source of truth for navigation and command search.
- `workspace-types.ts` defines cross-module entity contracts.
- `workspace-context.tsx` is a replaceable data adapter used by Projects, Tasks, Knowledge, Home, and AI context summaries.
- `components/workspace/` contains reusable page, section, state, status, and create-panel primitives.

The adapter now persists Projects, Tasks, Knowledge, and Activity per authenticated user through FastAPI. Legacy per-user browser data is imported once through an idempotent endpoint. Career keeps its compatibility APIs while normalized jobs, applications, documents, and document versions are populated alongside legacy history records.

Every cross-workspace entity currently includes:

```ts
interface WorkspaceEntity {
  id: string;
  user_id: number;
  module: WorkspaceModuleId;
  created_at: string;
  updated_at: string;
}
```

## Target unified data model

### Core tables

- `workspace_entities`: optional universal identity/index for cross-module search and relations.
- `activities`: append-only user activity stream with entity references and metadata.
- `projects`: project identity, status, progress, dates, summary, next action.
- `milestones`: ordered outcomes within a project.
- `tasks`: task state, priority, due date, source module, and relations.
- `knowledge_items`: note/research/link/source content and extracted metadata.
- `documents`: logical document identity, owner module, storage path, and metadata.
- `document_versions`: version number, source, checksum, storage path, and generation metadata.
- `integrations`: provider, connection state, scopes, external account, encrypted credential reference.
- `automations`: definition, schedule, enabled state, owner module, and cost guardrails.
- `automation_runs`: status, timestamps, retry, counts, errors, model usage, and cost.
- `notifications`: user attention items with read/dismissed state.
- `ai_conversations`, `ai_messages`, `ai_tool_calls`, `ai_action_approvals`: global Copilot history and action boundary.

All tables require `user_id`, indexes beginning with `user_id`, and Supabase Row Level Security policies that compare `auth.uid()` with `user_id`. Cross-entity relations use `entity_type + entity_id` only at API boundaries; high-value relations also receive explicit foreign keys.

### Career-owned tables

Career keeps its own domain without defining the platform:

- `profiles`
- `experience_bullets`
- `jobs`
- `job_matches`
- `applications`
- `resume_versions`
- `cover_letters`
- `interview_sessions`

Career documents also publish into the shared `documents` and `document_versions` index, so Home, Search, Knowledge, and Copilot can use them without depending on Career-specific schemas.

## Home Command Center contract

Home answers five questions before showing metrics:

1. What needs attention today?
2. What should I continue?
3. What does the workspace suggest?
4. What is coming up?
5. What changed recently, including automation health?

Suggestions must always disclose their source and must never imply that an AI call occurred when they are derived locally. Automation status comes from real health/run data. Empty, loading, and error states are first-class component states.

## Old-to-new route migration

| Existing capability | New workspace location | Compatibility |
| --- | --- | --- |
| Dashboard/application history | `/career/applications` | Existing history API and PDF downloads retained |
| Job search and match | `/search` under Career > Jobs | Route retained |
| Resume + Cover Letter + ATS | `/generate` under Career > Resume Studio | Route and generation API retained |
| Profile and bullet library | `/profile` under Career > Career Profile | Route retained |
| Templates | `/templates`, linked from Documents and Career | Route retained |
| Home | `/` Command Center | Replaced career statistics with cross-workspace attention |
| Knowledge placeholder | `/knowledge` usable knowledge library | Replaced with create/search foundation |
| Copilot placeholder | `/copilot` global entry | Existing AI workflows linked; chat runtime explicitly marked as pending |

No existing generation, ATS, cover letter, history, profile, search, compile, or download endpoint is removed.

## Migration sequence

### 1. Stabilize the platform shell

- Keep the registry-driven navigation and shared component primitives.
- Add route-level error boundaries, skeletons, and accessible announcements.
- Add module permission keys even while every module remains enabled.

### 2. Move the workspace adapter to server storage — complete on FastAPI

- Created `projects`, `tasks`, `knowledge_items`, and `activities` with enforced user scoping.
- Replaced local adapter methods with a FastAPI repository implementing the same interface.
- Import per-user browser data once, verify counts, then mark local storage migrated.
- Use Supabase Realtime only for surfaces that materially benefit from it.

### 3. Migrate Career storage

- Map local numeric users to Supabase Auth UUIDs.
- Split `history_records` into `applications`, `resume_versions`, and `cover_letters`.
- Create `jobs` and `job_matches`; bind every generation to `job_id` and `application_id`.
- Upload PDF, LaTeX, and TXT assets to private Supabase Storage paths scoped by user id.
- Keep compatibility endpoints in FastAPI during the transition.

### 4. Add the shared document index

- Index Career artifacts and general uploads in `documents`.
- Add immutable `document_versions` and signed download URLs.
- Publish document activity into the shared activity feed.

### 5. Move background work to managed jobs

- Define a common automation contract: input, idempotency key, timeout, retry, counters, errors, token usage, and cost.
- Run ingestion/matching in Cloud Run Jobs triggered by Cloud Scheduler.
- Store execution state in `automation_runs`; Home reads only real status.

### 6. Connect the global AI runtime

- Build a context service that retrieves only user-authorized entities.
- Give every tool an explicit read/write scope and confirmation requirement.
- Persist conversations, cited sources, generated artifacts, tool calls, model usage, and cost.
- Keep destructive or external actions behind a preview and human confirmation.

### 7. Add modules without changing the core

New modules register navigation, entity types, search providers, command actions, AI context providers, and permission scopes. They do not add fields to Career tables or special cases to Home.

## Deployment boundaries

- **Next.js / Vercel**: presentation, route composition, session-aware UI, command palette.
- **FastAPI / Cloud Run**: domain APIs, model orchestration, signed storage operations, permission checks.
- **Supabase Auth/PostgreSQL/Storage**: identity, RLS, primary data, files.
- **Cloud Run Jobs + Scheduler**: ingestion, matching, sync, retries, and recurring work.
- **Claude API**: structured analysis, document creation, refinement, summaries, and global Copilot reasoning.

This boundary preserves a modular product: modules can evolve independently while identity, activity, tasks, documents, search, permissions, and AI context remain shared platform capabilities.
