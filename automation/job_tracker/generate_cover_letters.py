"""
generate_cover_letters.py

Queries Notion for jobs with Status = "Generate CL", runs the full Auto-Resume
pipeline (JD parse → bullet retrieval → resume generation → ATS optimization →
cover letter), saves output files, compiles resume to PDF, uploads to Google
Drive, and writes the cover letter + PDF link back to Notion with Status →
"Ready to Apply".

Usage:
    python generate_cover_letters.py
"""

import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup

import anthropic
from dotenv import load_dotenv
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from notion_client import Client

# Resolve the Auto-Resume repository root from this script's location.
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

ATS_THRESHOLDS = {"overall": 80, "keyword_pct": 60, "relevance": 80, "impact": 80}
MAX_ATS_ROUNDS = 3

DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"]
CREDENTIALS_PATH = Path(
    os.environ.get(
        "GOOGLE_CREDENTIALS_PATH",
        AUTO_RESUME / "automation" / "job_tracker" / "credentials.json",
    )
)
TOKEN_PATH = CREDENTIALS_PATH.parent / "token.json"
DRIVE_FOLDER_NAME = "Auto-Resume PDFs"


def get_drive_service():
    creds = None
    if TOKEN_PATH.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), DRIVE_SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_PATH), DRIVE_SCOPES)
            creds = flow.run_local_server(port=0)
        TOKEN_PATH.write_text(creds.to_json())
    return build("drive", "v3", credentials=creds)


def get_or_create_drive_folder(service) -> str:
    """Return the Drive folder ID for DRIVE_FOLDER_NAME, creating it if needed."""
    query = f"name='{DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    results = service.files().list(q=query, fields="files(id)").execute()
    files = results.get("files", [])
    if files:
        return files[0]["id"]
    folder = service.files().create(
        body={"name": DRIVE_FOLDER_NAME, "mimeType": "application/vnd.google-apps.folder"},
        fields="id",
    ).execute()
    return folder["id"]


def compile_pdf(tex_path: Path) -> Path:
    """Compile .tex to .pdf using pdflatex. Returns the PDF path."""
    result = subprocess.run(
        ["pdflatex", "-interaction=nonstopmode", "-output-directory", str(tex_path.parent), str(tex_path)],
        capture_output=True, text=True
    )
    pdf_path = tex_path.with_suffix(".pdf")
    if not pdf_path.exists():
        raise RuntimeError(f"pdflatex failed:\n{result.stdout}\n{result.stderr}")
    return pdf_path


def upload_pdf_to_drive(service, pdf_path: Path, folder_id: str) -> str:
    """Upload PDF to Drive folder and return a shareable link."""
    media = MediaFileUpload(str(pdf_path), mimetype="application/pdf")
    file = service.files().create(
        body={"name": pdf_path.name, "parents": [folder_id]},
        media_body=media,
        fields="id",
    ).execute()
    file_id = file["id"]
    # Make publicly viewable (anyone with link)
    service.permissions().create(
        fileId=file_id,
        body={"type": "anyone", "role": "reader"},
    ).execute()
    return f"https://drive.google.com/file/d/{file_id}/view"


def fetch_description_from_url(url: str, title: str = "", company: str = "") -> str:
    """Fetch job description via jobspy (preferred) or HTML scrape fallback."""
    # Try jobspy first — it handles Indeed auth properly
    if title and company:
        try:
            from jobspy import scrape_jobs
            results = scrape_jobs(
                site_name=["indeed"],
                search_term=f"{title} {company}",
                location="Canada",
                results_wanted=10,
                country_indeed="Canada",
            )
            if not results.empty:
                # Match by job ID in URL
                jk = re.search(r"jk=([a-f0-9]+)", url)
                if jk:
                    match = results[results["job_url"].str.contains(jk.group(1), na=False)]
                    if not match.empty:
                        desc = str(match.iloc[0]["description"] or "")
                        if desc:
                            return desc[:6000]
                # Fallback: first result with a description
                for _, row in results.iterrows():
                    desc = str(row.get("description") or "")
                    if desc and company.lower() in str(row.get("company", "")).lower():
                        return desc[:6000]
        except Exception as e:
            print(f"  Warning: jobspy fetch failed — {e}")

    # HTML scrape fallback
    try:
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header"]):
            tag.decompose()
        return soup.get_text(separator="\n", strip=True)[:6000]
    except Exception as e:
        print(f"  Warning: HTML fetch failed — {e}")
        return ""


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
            "url": props.get("URL", {}).get("url") or "",
        })
    return jobs


def save_outputs(company: str, title: str, resume_tex: str, cover_letter: str) -> dict[str, Path]:
    OUTPUT_DIR.mkdir(exist_ok=True)
    slug = re.sub(r"[^\w]+", "_", f"{company}_{title}").lower()[:40]
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    base = OUTPUT_DIR / f"{ts}_{slug}"

    tex_path = base.with_suffix(".tex")
    cl_path = Path(str(base) + "_cover_letter.txt")

    tex_path.write_text(resume_tex, encoding="utf-8")
    cl_path.write_text(cover_letter, encoding="utf-8")

    return {"tex": tex_path, "cover_letter": cl_path}


def update_notion_page(notion: Client, page_id: str, cover_letter: str, notes: str, pdf_url: str | None = None, ats_score: int | None = None) -> None:
    chunks = [cover_letter[i:i + 2000] for i in range(0, len(cover_letter), 2000)]
    properties: dict = {
        "Cover Letter": {
            "rich_text": [{"text": {"content": c}} for c in chunks]
        },
        "Notes": {
            "rich_text": [{"text": {"content": notes}}]
        },
        "Status": {"select": {"name": "Ready to Apply"}},
    }
    if pdf_url:
        properties["Resume PDF"] = {"url": pdf_url}
    if ats_score is not None:
        properties["ATS Score"] = {"number": ats_score}
    notion.pages.update(page_id=page_id, properties=properties)


def run_pipeline(job: dict, profile: dict, claude: anthropic.Anthropic) -> None:
    title, company = job["title"], job["company"]
    description = job["description"]

    if not description:
        if job.get("url"):
            print(f"  No description — fetching via jobspy ...")
            description = fetch_description_from_url(job["url"], title, company)
        if not description:
            print(f"  No description and URL fetch failed — skipping.")
            return

    print(f"  [1/5] Parsing JD ...")
    jd_analysis = parse_jd(description, claude)

    print(f"  [2/5] Retrieving relevant bullets ...")
    filtered_profile = retrieve_relevant_content(profile, jd_analysis, claude)

    print(f"  [3/5] Generating resume ...")
    resume_tex = generate_resume(filtered_profile, jd_analysis, claude)

    print(f"  [4/5] ATS optimization ...")
    final_ats_score = 0
    for round_num in range(1, MAX_ATS_ROUNDS + 1):
        ats = score_resume(resume_tex, jd_analysis, claude)
        kw = ats["keyword_match"]
        sem = ats["semantic"]
        final_ats_score = sem["overall_score"]
        print(f"        Round {round_num}: overall={sem['overall_score']} keyword={kw['score']:.0f}% relevance={sem['relevance_score']} impact={sem['impact_score']}")

        passed = (
            sem["overall_score"] >= ATS_THRESHOLDS["overall"]
            and kw["score"] >= ATS_THRESHOLDS["keyword_pct"]
            and sem["relevance_score"] >= ATS_THRESHOLDS["relevance"]
            and sem["impact_score"] >= ATS_THRESHOLDS["impact"]
        )
        if passed:
            print(f"        All thresholds met.")
            break
        if round_num < MAX_ATS_ROUNDS:
            print(f"        Refining ...")
            resume_tex = refine_resume(resume_tex, ats, jd_analysis, filtered_profile, claude)

    print(f"  [5/5] Generating cover letter ...")
    cover_letter = generate_cover_letter(filtered_profile, jd_analysis, claude)

    files = save_outputs(company, title, resume_tex, cover_letter)
    print(f"  Saved:\n    {files['tex']}\n    {files['cover_letter']}")

    print(f"  [6/6] Compiling PDF & uploading to Drive ...")
    pdf_url = None
    try:
        pdf_path = compile_pdf(files["tex"])
        drive = get_drive_service()
        folder_id = get_or_create_drive_folder(drive)
        pdf_url = upload_pdf_to_drive(drive, pdf_path, folder_id)
        print(f"  PDF uploaded: {pdf_url}")
    except Exception as e:
        print(f"  Warning: PDF upload failed — {e}")

    notes = f"Resume: {files['tex']}\nCover Letter: {files['cover_letter']}"
    notion = Client(auth=NOTION_TOKEN)
    update_notion_page(notion, job["page_id"], cover_letter, notes, pdf_url, final_ats_score)
    print(f"  Notion updated -> Ready to Apply\n")


def main() -> None:
    notion = Client(auth=NOTION_TOKEN)
    claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    # Trigger Drive auth on first run (saves token.json for subsequent runs)
    try:
        get_drive_service()
    except Exception as e:
        print(f"Warning: Google Drive auth failed — {e}\nPDF upload will be skipped.")

    with open(PROFILE_PATH) as f:
        profile = json.load(f)

    jobs = get_jobs_to_process(notion)
    if not jobs:
        print("No jobs with Status = 'Generate CL' found.")
        return

    print(f"Found {len(jobs)} job(s) to process.\n")
    for job in jobs:
        print(f"Processing: {job['title']} @ {job['company']}")
        try:
            run_pipeline(job, profile, claude)
        except Exception as e:
            print(f"  Error: {e}\n")


if __name__ == "__main__":
    main()
