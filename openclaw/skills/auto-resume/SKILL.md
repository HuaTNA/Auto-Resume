---
name: auto-resume
description: Drive Hua's Auto-Resume platform — search jobs, generate tailored resumes and cover letters, assemble application kits, and track application status via its REST API
---

# Auto-Resume

Operate Hua's career platform through its REST API. Never scrape or click the
web UI — every capability below has an endpoint.

## Connection

- Base URL: `$AUTO_RESUME_API_URL` (the deployed FastAPI backend, not the Vercel frontend)
- Auth: send `Authorization: Bearer $AUTO_RESUME_TOKEN` on every request
- If a request returns 401, the token expired — tell Hua to re-run
  `python scripts/issue_agent_token.py`; do not retry or guess credentials
- If the base URL is unreachable, report it and stop; do not try other hosts or ports

## Endpoints

| Action | Call |
| --- | --- |
| Health check | `GET /api/health` |
| Search + rank jobs | `POST /api/search-jobs` `{"query", "location", "top_n"}` |
| Full generation pipeline | `POST /api/generate-full` `{"jd_text", "template", "top_k"}` |
| List applications | `GET /api/history` |
| Application detail | `GET /api/history/{id}` |
| Update status | `PATCH /api/history/{id}` `{"status"}` — one of generated/applied/interview/offer/rejected |
| Compile resume PDF | `POST /api/compile-pdf` |
| Compile cover letter PDF | `POST /api/compile-cover-letter-pdf` |

Templates: `classic` (default), `modern`, `consulting`. `generate-full` runs the
whole pipeline (JD parse → bullet retrieval → LaTeX generation → ATS scoring with
up to 3 refinement rounds → cover letter) and can take several minutes — warn Hua
it is running, then poll nothing; just wait for the response.

## Commands Hua will use in chat

### "generate" / a pasted JD

1. Confirm template choice if not stated (default `classic`).
2. Call `POST /api/generate-full` with the JD text.
3. Report ATS scores (overall / keyword / relevance / impact) and rounds used.
4. Send the resume PDF and cover letter back into the chat as files.

### "apply N" — assemble an application kit

`N` refers to a job from today's search digest or a history record id (confirm
which if ambiguous).

1. Fetch the job's JD (from the digest context or `GET /api/history/{id}`).
2. Run the generation pipeline as above.
3. Reply with one message containing:
   - Resume PDF + cover letter PDF
   - The direct application link
   - Pre-drafted answers for common form fields: why this company (2-3 sentences
     grounded in the JD), availability, work authorization, salary expectation,
     LinkedIn/GitHub/portfolio links — pull personal facts from the profile via
     `GET /api/profile`, never invent them
4. Hua submits manually. Never submit, click, or automate any external
   application form.

### "applied N" (also interview/offer/rejected)

Call `PATCH /api/history/{id}` with the new status and confirm.

## Hard rules

- External job submission is always manual. Do not open, fill, or submit
  application forms on any external site, even if asked to "just this once" —
  ask Hua to confirm the rule change in the project repo first.
- Before generating materials, show the parsed JD summary (company, role, top
  requirements) and wait for Hua's go-ahead, unless he already said "apply N".
- Never read, print, or transmit `.env` files or any credential values.
- Report failures honestly with the API's error detail; never fabricate scores
  or file paths.
