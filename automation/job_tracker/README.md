# Notion Job Tracker Automation

This automation searches job boards, stores new roles in a Notion database,
and can generate tailored resumes and cover letters through the Auto-Resume
pipeline.

## Included scripts

- `job_search.py`: searches for jobs, deduplicates them against Notion, archives
  old `New` entries, adds new jobs, and emails a run summary.
- `generate_cover_letters.py`: processes Notion entries marked `Generate CL`,
  generates application materials, uploads PDFs to Google Drive, and updates
  Notion.
- `watcher.py`: polls Notion every five minutes for `Generate CL` entries.
- `run_job_search.bat`: Windows Task Scheduler entry point.

The current `job_search.py` configuration enables Indeed. JobSpy also supports
LinkedIn; add `"linkedin"` to `site_name` if LinkedIn collection is required.

## Setup

1. Create a virtual environment at the repository root and install dependencies:

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r automation\job_tracker\requirements.txt
   ```

2. Copy the variables from `.env.example` into the repository root `.env` and
   fill in the real values. Never commit `.env`, `credentials.json`, or
   `token.json`.

3. If cover-letter generation is needed, put the Google OAuth desktop client
   file at `automation/job_tracker/credentials.json`, or set
   `GOOGLE_CREDENTIALS_PATH` to its location.

4. Run the search manually:

   ```powershell
   .\automation\job_tracker\run_job_search.bat
   ```

For scheduled execution, configure Windows Task Scheduler to launch
`run_job_search.bat` from this directory.
