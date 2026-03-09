# AI Resume Generator

Generate tailored resumes, cover letters, and find jobs — all powered by Claude API. Includes a full web UI and CLI.

## Features

- **Smart JD Parsing** — Extracts skills, keywords, responsibilities, soft requirements, deal-breakers from any job description. Includes noise cleaning to remove benefits/legal/salary sections and save API tokens.
- **Intelligent Bullet Retrieval** — 5-priority strategy (deal-breaker match, responsibility mirror, keyword density, soft requirement proof, bonus signal match) to select the most relevant bullets from your profile.
- **LaTeX Resume Generation** — Fills your LaTeX template with tailored content, mirrors JD terminology and action verbs, bolds key metrics.
- **ATS Scoring + Auto-Optimization** — Keyword matching + Claude semantic analysis. Iteratively refines the resume (up to 3 rounds) until it meets score thresholds (overall: 80, keyword: 60%, relevance: 80, impact: 80).
- **Cover Letter Generation** — Produces a tailored 3-4 paragraph cover letter that addresses the JD's technical and soft requirements.
- **Multiple Templates** — Switch between `classic`, `modern` (blue accents), and `consulting` (conservative) styles.
- **Job Search** — Search jobs via Adzuna API, ranked by Claude against your profile.
- **Application History** — Tracks every resume generated: company, role, ATS scores, template, and application status. Expandable detail view with content preview.
- **PDF Compilation** — Compiles LaTeX resumes and cover letters to PDF via pdflatex, downloadable from both CLI and web UI.
- **Web UI** — Full-featured Next.js frontend with FastAPI backend: dashboard with stats, generate page with step-by-step progress, job search, template picker, profile management, and file downloads (LaTeX/PDF/TXT).

## Architecture

```text
profile.json + JD text input
              |
    [1] JD Noise Cleaner    -> removes benefits, legal, salary noise
    [2] JD Parser            -> extracts structured requirements (Claude API)
    [3] Bullet Retriever     -> selects top-k relevant bullets (Claude API)
    [4] Resume Generator     -> fills LaTeX template (Claude API)
    [5] ATS Scorer           -> keyword + semantic scoring (Claude API)
         |--- below threshold? -> refine and re-score (up to 3 rounds)
    [6] Cover Letter         -> tailored cover letter (Claude API)
    [7] PDF Compiler         -> pdflatex compilation
              |
    output/*.tex, *.txt, *.pdf, *_cover_letter.txt
```

## Quick Start (Web UI)

```bash
# Windows: one-click launcher
start.bat

# Or manually:
# Terminal 1 — Backend
pip install -r requirements.txt
uvicorn api.server:app --reload --port 8000

# Terminal 2 — Frontend
cd frontend && npm install && npm run dev
```

Open <http://localhost:3000> in your browser.

## Setup

```bash
# 1. Install dependencies
pip install -r requirements.txt
cd frontend && npm install && cd ..

# 2. Create .env with your API key
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env

# 3. (Optional) For job search, add Adzuna keys — free at https://developer.adzuna.com/
echo "ADZUNA_APP_ID=your_id" >> .env
echo "ADZUNA_APP_KEY=your_key" >> .env

# 4. (Optional) Install pdflatex for PDF output
# Windows: install MiKTeX — https://miktex.org/download
```

## Web UI

The web frontend provides a complete interface for all features:

- **Dashboard** — Stats, application history with expandable rows to preview and download generated files
- **Generate** — 3-step flow: paste JD, analyze, generate & optimize. Download resume PDF, LaTeX, cover letter
- **Job Search** — Search Adzuna jobs, Claude-ranked by profile fit with match scores
- **Templates** — Visual template picker (classic, modern, consulting) — click to generate
- **Profile** — Manage personal info, skills, experience, and projects

### Dashboard Detail View

Click any history row to expand and access:

- **Resume PDF** / **LaTeX source** download
- **Cover Letter PDF** / **TXT** download
- Tab preview of resume LaTeX and cover letter content
- Inline status updates (generated → applied → interview → offer/rejected)

## CLI Usage

### Generate Resume + Cover Letter

```bash
# From a JD file
python main.py generate --jd path/to/jd.txt

# Interactive mode (paste JD in terminal)
python main.py generate

# Choose a template
python main.py generate --jd jd.txt --template modern

# Skip cover letter
python main.py generate --jd jd.txt --no-cover-letter

# More bullets
python main.py generate --jd jd.txt --top-k 15
```

### Search Jobs

```bash
python main.py search --query "Machine Learning Engineer" --location canada
python main.py search --query "Data Scientist" --location us --top-n 5
```

### View Application History

```bash
python main.py history
python main.py history --update 1:applied
python main.py history --update 1:interview
```

Status flow: `generated` -> `applied` -> `interview` -> `offer` / `rejected`

### List Templates

```bash
python main.py templates
```

Available: `classic` (default), `modern` (blue accents), `consulting` (conservative)

## Output

Each run produces:

```text
output/
  20260309_143022_ml_engineer.tex             # LaTeX source
  20260309_143022_ml_engineer.txt             # Plain text (for Overleaf)
  20260309_143022_ml_engineer.pdf             # Compiled PDF
  20260309_143022_ml_engineer_cover_letter.txt # Cover letter
```

## API Endpoints

| Method | Path                            | Description                    |
| ------ | ------------------------------- | ------------------------------ |
| GET    | `/api/health`                   | Health check                   |
| GET    | `/api/profile`                  | Get profile with stats         |
| PUT    | `/api/profile/personal`         | Update personal info           |
| PUT    | `/api/profile/skills`           | Update skills                  |
| POST   | `/api/profile/experience`       | Add experience                 |
| DELETE | `/api/profile/experience/{id}`  | Delete experience              |
| POST   | `/api/profile/project`          | Add project                    |
| DELETE | `/api/profile/project/{id}`     | Delete project                 |
| GET    | `/api/templates`                | List templates                 |
| POST   | `/api/parse-jd`                 | Parse job description          |
| POST   | `/api/retrieve-bullets`         | Select relevant bullets        |
| POST   | `/api/generate`                 | Generate resume + cover letter |
| POST   | `/api/score`                    | ATS score a resume             |
| POST   | `/api/refine`                   | Refine resume with ATS feedback|
| POST   | `/api/generate-full`            | Full pipeline in one call      |
| GET    | `/api/history`                  | List history (light)           |
| GET    | `/api/history/{id}`             | Get record with full content   |
| PATCH  | `/api/history/{id}`             | Update status                  |
| POST   | `/api/history`                  | Save new record                |
| POST   | `/api/compile-pdf`              | Compile LaTeX to PDF           |
| POST   | `/api/compile-cover-letter-pdf` | Compile cover letter to PDF    |
| POST   | `/api/search-jobs`              | Search + rank jobs             |

## Customizing Your Profile

Edit `data/profile.json`. Each bullet needs:

```json
{
  "id": "b001",
  "text": "Built a production RAG system processing 100+ meetings/week...",
  "tags": ["RAG", "NLP", "Python"]
}
```

Tags help the retriever match bullets to JD keywords more accurately.

## Project Structure

```text
main.py                     # CLI entry point with subcommands
api/
  server.py                 # FastAPI backend (REST API)
frontend/
  src/app/                  # Next.js App Router pages
    page.tsx                # Dashboard
    generate/page.tsx       # Generate resume flow
    search/page.tsx         # Job search
    templates/page.tsx      # Template picker
    profile/page.tsx        # Profile management
  src/components/           # Shared components (Sidebar, Header)
  src/lib/api.ts            # API client
src/
  jd_parser.py              # JD noise cleaning + structured parsing
  retriever.py              # 5-priority bullet selection
  generator.py              # LaTeX resume generation + refinement
  ats_scorer.py             # Keyword + semantic ATS scoring
  cover_letter.py           # Cover letter generation
  templates.py              # Multi-template manager
  job_finder.py             # Job search via Adzuna API
  history.py                # Application history tracking
data/
  template.tex              # Classic LaTeX template
  template_modern.tex       # Modern template (blue accents)
  template_consulting.tex   # Consulting template (conservative)
  profile.json              # Your profile (gitignored)
  sample_jd.txt             # Example JD
start.bat                   # One-click launcher (Windows)
```

## Tech Stack

- **AI**: Claude API (claude-sonnet-4-20250514) for all NLP operations
- **Backend**: FastAPI + Uvicorn
- **Frontend**: Next.js 16 (App Router) + TypeScript + Tailwind CSS
- **Resume**: LaTeX templates + pdflatex compilation
- **Job Search**: Adzuna API (free tier)
- **Icons**: Material Symbols Outlined

## Roadmap

- [x] CLI prototype with Claude API pipeline
- [x] LaTeX output with custom templates
- [x] ATS scoring with iterative optimization
- [x] Cover letter generation
- [x] Job search + ranking
- [x] Application history tracking
- [x] Multi-template support
- [x] Web UI (Next.js + FastAPI)
- [x] PDF compilation + download (resume & cover letter)
- [x] Profile management (CRUD)
- [ ] Vertex AI embeddings for better retrieval
- [ ] LinkedIn profile import
- [ ] Batch resume generation
- [ ] Deploy to Vercel + Railway
