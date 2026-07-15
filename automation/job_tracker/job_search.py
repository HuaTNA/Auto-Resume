import os
import re
import smtplib
from datetime import date, timedelta
from email.mime.text import MIMEText
from pathlib import Path

from dotenv import load_dotenv
from jobspy import scrape_jobs
from notion_client import Client

AUTO_RESUME = Path(__file__).resolve().parents[2]
load_dotenv(AUTO_RESUME / ".env")

NOTION_TOKEN = os.environ["NOTION_TOKEN"]
NOTION_DB_ID = os.environ["NOTION_DB_ID"]
GMAIL_ADDRESS = os.environ["GMAIL_ADDRESS"]
GMAIL_APP_PASSWORD = os.environ["GMAIL_APP_PASSWORD"]

SEARCH_TERMS = ["Machine Learning Engineer", "LLM Engineer", "AI Engineer"]
LOCATIONS = ["Toronto, ON", "Remote"]



def archive_old_new_jobs(notion: Client) -> int:
    cutoff = date.today() - timedelta(days=10)
    archived = 0
    cursor = None

    while True:
        response = notion.databases.query(
            database_id=NOTION_DB_ID,
            start_cursor=cursor,
            page_size=100,
            filter={
                "and": [
                    {"property": "Status", "select": {"equals": "New"}},
                    {"property": "Date Found", "date": {"before": cutoff.isoformat()}},
                ]
            },
        )

        for page in response["results"]:
            if page.get("archived"):
                continue
            notion.pages.update(page_id=page["id"], archived=True)
            archived += 1

        if not response["has_more"]:
            break
        cursor = response["next_cursor"]

    return archived


def get_existing_job_ids(notion: Client) -> set[str]:
    existing: set[str] = set()
    cursor = None
    while True:
        response = notion.databases.query(
            database_id=NOTION_DB_ID,
            start_cursor=cursor,
            page_size=100,
            filter={"property": "Job ID", "rich_text": {"is_not_empty": True}},
        )
        for page in response["results"]:
            rich_text = page["properties"].get("Job ID", {}).get("rich_text", [])
            if rich_text:
                existing.add(rich_text[0]["text"]["content"])
        if not response["has_more"]:
            break
        cursor = response["next_cursor"]
    return existing


def score_job(title: str) -> str:
    t = title.lower()
    high = [
        "machine learning engineer", "ml engineer",
        "llm", "large language model",
        "ai engineer", "ai/ml engineer",
        "nlp engineer", "nlp scientist",
        "generative ai engineer", "gen ai engineer",
        "applied ai engineer", "applied ml",
        "staff ai engineer", "principal ai engineer",
    ]
    medium = [
        "data scientist", "applied scientist",
        "deep learning", "computer vision",
        "mlops", "ml platform", "ml infrastructure",
        "ai researcher", "research engineer",
        "ai data engineer", "ai operations",
        "full stack ai", "forward deployed",
        "gen ai", "generative ai",
    ]
    for kw in high:
        if kw in t:
            return "High"
    for kw in medium:
        if kw in t:
            return "Medium"
    return "Low"


def add_job(notion: Client, job: dict) -> None:
    notion.pages.create(
        parent={"database_id": NOTION_DB_ID},
        properties={
            "Job Title": {"title": [{"text": {"content": job["title"]}}]},
            "Company": {"rich_text": [{"text": {"content": job["company"]}}]},
            "Location": {"rich_text": [{"text": {"content": job["location"]}}]},
            "Status": {"select": {"name": "New"}},
            "URL": {"url": job["url"] or None},
            "Date Found": {"date": {"start": str(date.today())}},
            "Salary": {"rich_text": [{"text": {"content": job["salary"]}}]},
            "Job ID": {"rich_text": [{"text": {"content": job["job_id"]}}]},
            "Match Score": {"select": {"name": score_job(job["title"])}},
            "Description": {"rich_text": [{"text": {"content": job["description"][i:i+2000]}} for i in range(0, min(len(job["description"]), 8000), 2000)] or [{"text": {"content": ""}}]},
        },
    )


def send_email(count: int) -> None:
    today = date.today().strftime("%Y-%m-%d")
    body = (
        f"{count} new jobs added to your Notion Job Tracker today."
        if count > 0
        else "No new jobs found today."
    )
    msg = MIMEText(body)
    msg["Subject"] = f"Job Tracker Daily Update â€” {today}"
    msg["From"] = GMAIL_ADDRESS
    msg["To"] = GMAIL_ADDRESS
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
        smtp.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
        smtp.send_message(msg)


def main() -> None:
    notion = Client(auth=NOTION_TOKEN)
    archived = archive_old_new_jobs(notion)
    print(f"Archived {archived} New jobs older than 10 days.")
    existing_ids = get_existing_job_ids(notion)
    print(f"Existing jobs in Notion: {len(existing_ids)}")

    new_jobs: list[dict] = []

    for term in SEARCH_TERMS:
        for location in LOCATIONS:
            print(f"Searching: '{term}' in {location} ...")
            try:
                df = scrape_jobs(
                    site_name=["indeed"],
                    search_term=term,
                    location=location,
                    country_indeed="Canada",
                    results_wanted=20,
                )
            except Exception as e:
                print(f"  Search error: {e}")
                continue

            for _, row in df.iterrows():
                # Extract Job ID from id field or URL
                job_id = str(row.get("id") or "").strip()
                url = str(row.get("job_url") or "").strip()
                if not job_id:
                    m = re.search(r"jk=([a-z0-9]+)", url)
                    job_id = m.group(1) if m else url

                if not job_id or job_id in existing_ids:
                    continue

                # Format salary
                salary = ""
                min_s, max_s = row.get("min_amount"), row.get("max_amount")
                currency = str(row.get("currency") or "CAD")
                if min_s and max_s:
                    salary = f"{currency} {int(min_s):,}â€“{int(max_s):,}"
                elif min_s:
                    salary = f"{currency} {int(min_s):,}+"

                new_jobs.append({
                    "title": str(row.get("title") or "").strip(),
                    "company": str(row.get("company") or "").strip(),
                    "location": str(row.get("location") or "").strip(),
                    "url": url,
                    "salary": salary,
                    "job_id": job_id,
                    "description": str(row.get("description") or "").strip(),
                })
                existing_ids.add(job_id)  # prevent intra-run duplicates

    print(f"New jobs to add: {len(new_jobs)}")
    added = 0
    for job in new_jobs:
        try:
            add_job(notion, job)
            added += 1
            print(f"  + {job['title']} @ {job['company']}")
        except Exception as e:
            print(f"  Failed ({job['title']}): {e}")

    send_email(added)
    print(f"Done. {added} jobs added. Email sent to {GMAIL_ADDRESS}.")


if __name__ == "__main__":
    main()

