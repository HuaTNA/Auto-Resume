# Cloud deployment

Recommended low-cost architecture:

```text
Browser -> Vercel (Next.js) -> /api rewrite -> Cloud Run (FastAPI)
                                              -> Supabase PostgreSQL
Cloud Scheduler ----------------------------> /api/internal/automations/run-due
```

The Vercel rewrite is intentional. It keeps the authentication cookie on the
frontend origin and avoids third-party-cookie restrictions between
`vercel.app` and `run.app`.

## 1. Create PostgreSQL

Create a Supabase project and copy its PostgreSQL connection string. Prefer the
pooler connection string when the direct endpoint is not reachable over IPv4.
Append `sslmode=require` if it is not already present.

Do not upload `data/auto_resume.db`. New cloud tables are created automatically
when FastAPI starts. Existing local data requires a separate migration if it
needs to be preserved.

## 2. Prepare Cloud Run configuration

```bash
cp deploy/cloud-run.env.example.yaml deploy/cloud-run.env.yaml
python -c "import secrets; print(secrets.token_hex(32))"
python -c "import secrets; print(secrets.token_hex(32))"
```

Use the two generated values for `JWT_SECRET` and `CRON_SECRET`. Fill the other
placeholders in `deploy/cloud-run.env.yaml`. Never commit that file.

## 3. Deploy FastAPI to Cloud Run

The commands below assume a Google Cloud project with billing enabled and the
`gcloud` CLI authenticated.

```bash
gcloud config set project YOUR_GOOGLE_CLOUD_PROJECT
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com cloudscheduler.googleapis.com
gcloud run deploy auto-resume-api \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 2 \
  --memory 1Gi \
  --cpu 1 \
  --timeout 900 \
  --env-vars-file deploy/cloud-run.env.yaml
```

Save the resulting `https://...run.app` service URL and verify:

```bash
curl https://YOUR_SERVICE_URL/api/health
```

Expected response:

```json
{"status":"ok","db":"postgresql"}
```

## 4. Deploy Next.js to Vercel

Import the repository in Vercel and set the Root Directory to `frontend`.
Add one server-side environment variable:

```text
BACKEND_URL=https://YOUR_SERVICE_URL
```

Leave `NEXT_PUBLIC_API_URL` unset. The frontend will call `/api`, which Vercel
rewrites to Cloud Run. After Vercel assigns the production URL, update
`VERCEL_FRONTEND_URL` and `CORS_ORIGINS` on Cloud Run to that exact HTTPS URL.

## 5. Create the scheduler

One scheduler job can check all due automations every 15 minutes. Replace the
URL and secret with the values from the deployed service.

```bash
gcloud scheduler jobs create http auto-resume-run-due \
  --location us-central1 \
  --schedule "*/15 * * * *" \
  --time-zone "America/Toronto" \
  --uri "https://YOUR_SERVICE_URL/api/internal/automations/run-due" \
  --http-method POST \
  --headers "X-Cron-Secret=YOUR_CRON_SECRET"
```

Test it once:

```bash
gcloud scheduler jobs run auto-resume-run-due --location us-central1
```

## Production values

Backend:

- `DATABASE_URL`: Supabase PostgreSQL pooler URL
- `JWT_SECRET`: stable random value
- `CRON_SECRET`: independent stable random value
- `ANTHROPIC_API_KEY`: current AI provider key
- `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`: job-search credentials
- `PRODUCTION=true`
- `COOKIE_SECURE=true`
- `COOKIE_SAMESITE=lax`
- `CORS_ORIGINS`: exact Vercel production URL
- `OUTPUT_DIR=/tmp/auto-resume-output`

Frontend:

- `BACKEND_URL`: Cloud Run service URL
- `NEXT_PUBLIC_API_URL`: unset

For a public launch, move sensitive values from plain Cloud Run environment
variables into Google Secret Manager and add managed database migrations.

