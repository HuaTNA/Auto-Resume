# Cloud deployment

Recommended MVP architecture:

```text
Browser -> Vercel (Next.js frontend) -> /api rewrite -> Vercel (FastAPI backend)
                                                        -> Supabase PostgreSQL
```

Use two Vercel projects created from the same Git repository. The frontend
project has `frontend` as its Root Directory. The backend project uses the
repository root, where `server.py` exports the FastAPI application.

The frontend rewrite keeps authentication cookies on the frontend origin and
avoids third-party-cookie restrictions between two `vercel.app` domains.

## 1. Create Supabase PostgreSQL

Create a Supabase Free project in a region close to the Vercel backend. In the
Supabase dashboard, open **Connect** and copy the **Transaction pooler** URI
(port `6543`). Vercel Functions are serverless, so transaction mode is preferred
over a persistent direct connection. Append `sslmode=require` if it is absent:

```text
postgresql://postgres.PROJECT_REF:PASSWORD@POOLER_HOST:6543/postgres?sslmode=require
```

If the database password contains reserved URL characters, use the individual
`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_PORT`, and `DB_NAME` variables supported
by `api/database.py` instead of manually editing the URI.

Do not upload `data/auto_resume.db`. Cloud tables are created automatically on
the first FastAPI startup. Existing local data requires a separate migration if
it needs to be preserved.

Supabase Free does not include automatic database backups. Export a manual
backup before material schema changes or important demos.

## 2. Create the backend Vercel project

Import the repository into a new Vercel project named, for example,
`auto-resume-api`.

- Root Directory: repository root (`.`)
- Framework Preset: FastAPI, or leave framework detection enabled
- Entrypoint: `server.py` (detected automatically)

Configure these Production environment variables:

```text
DATABASE_URL=YOUR_SUPABASE_TRANSACTION_POOLER_URI
DB_POOL_SIZE=3
DB_MAX_OVERFLOW=2
JWT_SECRET=YOUR_RANDOM_64_HEX_VALUE
ANTHROPIC_API_KEY=YOUR_ANTHROPIC_KEY
ANTHROPIC_MODEL=claude-sonnet-4-6
REGISTRATION_MODE=invite
REGISTRATION_INVITE_CODE=YOUR_RANDOM_INVITE_CODE
API_REQUESTS_PER_MINUTE=12
API_DAILY_UNITS_PER_USER=60
PRODUCTION=true
COOKIE_SECURE=true
COOKIE_SAMESITE=lax
LOCAL_AUTOMATION_SCHEDULER=false
OUTPUT_DIR=/tmp/auto-resume-output
```

Optional job-search variables:

```text
ADZUNA_APP_ID=
ADZUNA_APP_KEY=
```

Generate independent secrets locally; never put their output in Git:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Deploy and verify:

```text
https://YOUR_BACKEND_PROJECT.vercel.app/api/health
```

Expected response:

```json
{"status":"ok","db":"postgresql"}
```

Vercel does not provide `pdflatex` in the Python runtime. The API therefore
uses the existing ReportLab renderer when LaTeX is unavailable. PDF compilation
accepts only a saved resume owned by the authenticated user; arbitrary client
TeX is not executed.

## 3. Create the frontend Vercel project

Import the same repository into a second project named, for example,
`auto-resume-web`.

- Root Directory: `frontend`
- Framework Preset: Next.js

Add this server-side environment variable:

```text
BACKEND_URL=https://YOUR_BACKEND_PROJECT.vercel.app
```

Leave `NEXT_PUBLIC_API_URL` unset in Production. The browser calls same-origin
`/api` routes, and the Next.js rewrite forwards them to the backend project.

Deploy the frontend. Then set the following values on the backend project and
redeploy it:

```text
VERCEL_FRONTEND_URL=https://YOUR_FRONTEND_PROJECT.vercel.app
CORS_ORIGINS=https://YOUR_FRONTEND_PROJECT.vercel.app
```

## 4. Verify the production flow

Test in this order:

1. Open `/register` and create an invited account.
2. Log out and log back in to verify the secure session cookie.
3. Save and reload the profile.
4. Generate a resume and wait for the generation job to complete.
5. Refresh History and confirm the result persisted in Supabase.
6. Download the resume and cover-letter PDFs.
7. If Adzuna is configured, run job search and confirm the match threshold is
   still enforced when AI ranking is unavailable.

Inspect the backend Vercel logs and Supabase table editor if any step fails.

## Production values

Backend Vercel project:

- `DATABASE_URL`: Supabase transaction pooler URL on port `6543`
- `JWT_SECRET`: stable random value
- `REGISTRATION_MODE=invite` and a strong `REGISTRATION_INVITE_CODE`
- `API_REQUESTS_PER_MINUTE` and `API_DAILY_UNITS_PER_USER`: server-funded API limits
- `ANTHROPIC_API_KEY`: current AI provider key
- `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`: optional job-search credentials
- `PRODUCTION=true`
- `COOKIE_SECURE=true`
- `COOKIE_SAMESITE=lax`
- `CORS_ORIGINS`: exact frontend production URL
- `LOCAL_AUTOMATION_SCHEDULER=false`
- `OUTPUT_DIR=/tmp/auto-resume-output`

Frontend Vercel project:

- `BACKEND_URL`: backend Vercel production URL
- `NEXT_PUBLIC_API_URL`: unset

The local SQLite runtime database must never be committed. If it appeared in a
previous revision, remove it from Git history before sharing the repository and
rotate credentials associated with any real accounts contained in that file.
