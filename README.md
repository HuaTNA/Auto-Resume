# AI Resume Generator — CLI Prototype

Generate a tailored resume from your profile + any job description using Claude API.

## Architecture

```
profile.json (your bullets/experiences)
      +
JD text input
      ↓
[1] JD Parser      → extracts skills, keywords, requirements
[2] Retriever      → selects top-k most relevant bullets
[3] Generator      → writes tailored resume in Markdown
      ↓
output/*.md
```

## Setup

```bash
# 1. Clone / download project
cd resume-ai

# 2. Install dependencies
pip install -r requirements.txt

# 3. Set your Anthropic API key
export ANTHROPIC_API_KEY=sk-ant-...
```

## Usage

```bash
# Use sample JD
python main.py --jd data/sample_jd.txt

# Use your own JD file
python main.py --jd /path/to/job.txt

# Interactive mode (paste JD in terminal)
python main.py

# Custom profile path
python main.py --jd data/sample_jd.txt --profile data/my_profile.json

# Retrieve more bullets (default: 12)
python main.py --jd data/sample_jd.txt --top-k 15
```

## Customizing Your Profile

Edit `data/profile.json` with your real experience.

Each bullet needs:
- `id`: unique string (e.g. "b001")
- `text`: the full bullet point
- `tags`: relevant keywords (helps retrieval)

## Output

Resumes are saved to `output/` as Markdown files:
```
output/20260305_143022_machine_learning_engineer.md
```

Convert to PDF with any Markdown→PDF tool, or paste into Notion/Google Docs.

## Roadmap

- [ ] v1: CLI prototype (this)
- [ ] v2: Vertex AI embeddings for better retrieval
- [ ] v3: PDF export
- [ ] v4: Web UI (Next.js + FastAPI)
- [ ] v5: Cloud SQL profile storage + multi-user
