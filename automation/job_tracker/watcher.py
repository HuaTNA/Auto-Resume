"""
watcher.py

Polls Notion every 5 minutes for jobs with Status = "Generate CL".
When found, runs the full Auto-Resume pipeline automatically.
Runs as a persistent PM2 process.
"""

import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

import anthropic
from dotenv import load_dotenv
from notion_client import Client

AUTO_RESUME = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(AUTO_RESUME))
from src.jd_parser import parse_jd
from src.retriever import retrieve_relevant_content
from src.generator import generate_resume, refine_resume
from src.ats_scorer import score_resume
from src.cover_letter import generate_cover_letter

load_dotenv(AUTO_RESUME / ".env")

NOTION_TOKEN = os.environ["NOTION_TOKEN"]
NOTION_DB_ID = os.environ["NOTION_DB_ID"]
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]

PROFILE_PATH = AUTO_RESUME / "data" / "profile.json"
OUTPUT_DIR = AUTO_RESUME / "output"
POLL_INTERVAL = 300  # 5 minutes

ATS_THRESHOLDS = {"overall": 80, "keyword_pct": 60, "relevance": 80, "impact": 80}
MAX_ATS_ROUNDS = 3


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)


def get_jobs_to_process(notion: Client) -> list[dict]:
    response = notion.databases.query(
        database_id=NOTION_DB_ID,
        filter={"property": "Status", "select": {"equals": "Generate CL"}},
    )
    jobs = []
    for page in response["results"]:
        props = page["properties"]

        def text(prop: str) -> str:
            rt = props.get(prop, {}).get("rich_text", [])
            return rt[0]["text"]["content"] if rt else ""

        def title(prop: str) -> str:
            t = props.get(prop, {}).get("title", [])
            return t[0]["text"]["content"] if t else ""

        jobs.append({
            "page_id": page["id"],
            "title": title("Job Title"),
            "company": text("Company"),
            "description": text("Description"),
        })
    return jobs


def save_outputs(company: str, title: str, resume_tex: str, cover_letter: str) -> dict:
    OUTPUT_DIR.mkdir(exist_ok=True)
    slug = re.sub(r"[^\w]+", "_", f"{company}_{title}").lower()[:40]
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    base = OUTPUT_DIR / f"{ts}_{slug}"
    tex_path = base.with_suffix(".tex")
    cl_path = Path(str(base) + "_cover_letter.txt")
    tex_path.write_text(resume_tex, encoding="utf-8")
    cl_path.write_text(cover_letter, encoding="utf-8")
    return {"tex": tex_path, "cover_letter": cl_path}


def update_notion(notion: Client, page_id: str, cover_letter: str, notes: str) -> None:
    chunks = [cover_letter[i:i + 2000] for i in range(0, len(cover_letter), 2000)]
    notion.pages.update(
        page_id=page_id,
        properties={
            "Cover Letter": {"rich_text": [{"text": {"content": c}} for c in chunks]},
            "Notes": {"rich_text": [{"text": {"content": notes}}]},
            "Status": {"select": {"name": "Ready to Apply"}},
        },
    )


def process_job(job: dict, profile: dict, claude: anthropic.Anthropic, notion: Client) -> None:
    title, company = job["title"], job["company"]

    if not job["description"]:
        log(f"  SKIP — no description for: {title} @ {company}")
        # Mark as New so it doesn't keep triggering
        notion.pages.update(
            page_id=job["page_id"],
            properties={"Status": {"select": {"name": "New"}}},
        )
        return

    log(f"  [1/5] Parsing JD ...")
    jd_analysis = parse_jd(job["description"], claude)

    log(f"  [2/5] Retrieving bullets ...")
    filtered_profile = retrieve_relevant_content(profile, jd_analysis, claude)

    log(f"  [3/5] Generating resume ...")
    resume_tex = generate_resume(filtered_profile, jd_analysis, claude)

    log(f"  [4/5] ATS optimization ...")
    for round_num in range(1, MAX_ATS_ROUNDS + 1):
        ats = score_resume(resume_tex, jd_analysis, claude)
        kw = ats["keyword_match"]
        sem = ats["semantic"]
        log(f"        Round {round_num}: overall={sem['overall_score']} kw={kw['score']:.0f}% relevance={sem['relevance_score']} impact={sem['impact_score']}")
        passed = (
            sem["overall_score"] >= ATS_THRESHOLDS["overall"]
            and kw["score"] >= ATS_THRESHOLDS["keyword_pct"]
            and sem["relevance_score"] >= ATS_THRESHOLDS["relevance"]
            and sem["impact_score"] >= ATS_THRESHOLDS["impact"]
        )
        if passed:
            log(f"        Thresholds met.")
            break
        if round_num < MAX_ATS_ROUNDS:
            resume_tex = refine_resume(resume_tex, ats, jd_analysis, filtered_profile, claude)

    log(f"  [5/5] Generating cover letter ...")
    cover_letter = generate_cover_letter(filtered_profile, jd_analysis, claude)

    files = save_outputs(company, title, resume_tex, cover_letter)
    notes = f"Resume: {files['tex']}\nCover Letter: {files['cover_letter']}"
    update_notion(notion, job["page_id"], cover_letter, notes)
    log(f"  Done → Ready to Apply | {files['tex'].name}")


def main() -> None:
    log("Job Tracker Watcher started. Polling every 5 minutes ...")

    notion = Client(auth=NOTION_TOKEN)
    claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    with open(PROFILE_PATH) as f:
        profile = json.load(f)

    while True:
        try:
            jobs = get_jobs_to_process(notion)
            if jobs:
                log(f"Found {len(jobs)} job(s) to process.")
                for job in jobs:
                    log(f"Processing: {job['title']} @ {job['company']}")
                    try:
                        process_job(job, profile, claude, notion)
                    except Exception as e:
                        log(f"  ERROR: {e}")
                        # Revert to New so it doesn't get stuck in Generate CL
                        notion.pages.update(
                            page_id=job["page_id"],
                            properties={"Status": {"select": {"name": "New"}}},
                        )
            else:
                log("No jobs pending. Next check in 5 min.")
        except Exception as e:
            log(f"Poll error: {e}")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
