"""
history.py
Tracks job application history: which jobs were applied to, resumes generated, ATS scores.
Prevents duplicate applications and enables analytics.
"""

import json
from datetime import datetime
from pathlib import Path

HISTORY_DIR = Path(__file__).parent.parent / "history"
HISTORY_FILE = HISTORY_DIR / "applications.json"


def _ensure_history():
    """Create history directory and file if needed."""
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    if not HISTORY_FILE.exists():
        HISTORY_FILE.write_text("[]", encoding="utf-8")


def _load_history() -> list[dict]:
    _ensure_history()
    return json.loads(HISTORY_FILE.read_text(encoding="utf-8"))


def _save_history(records: list[dict]):
    _ensure_history()
    HISTORY_FILE.write_text(json.dumps(records, indent=2, ensure_ascii=False), encoding="utf-8")


def add_record(jd_analysis: dict, ats_scores: dict = None,
               output_files: list[str] = None, template: str = None,
               resume_tex: str = None, cover_letter: str = None) -> dict:
    """
    Add a new application record to history.
    Returns the created record.
    """
    records = _load_history()

    record = {
        "id": len(records) + 1,
        "timestamp": datetime.now().isoformat(),
        "job_title": jd_analysis.get("job_title", "Unknown"),
        "company": jd_analysis.get("company", "Unknown"),
        "seniority": jd_analysis.get("seniority", ""),
        "required_skills": jd_analysis.get("required_skills", []),
        "template": template or "classic",
        "ats_scores": {
            "overall": ats_scores.get("semantic", {}).get("overall_score") if ats_scores else None,
            "keyword_pct": ats_scores.get("keyword_match", {}).get("score") if ats_scores else None,
            "relevance": ats_scores.get("semantic", {}).get("relevance_score") if ats_scores else None,
            "impact": ats_scores.get("semantic", {}).get("impact_score") if ats_scores else None,
        },
        "output_files": output_files or [],
        "resume_tex": resume_tex or "",
        "cover_letter": cover_letter or "",
        "status": "generated",  # generated | applied | interview | rejected | offer
    }

    records.append(record)
    _save_history(records)
    return record


def is_duplicate(company: str, job_title: str) -> bool:
    """Check if we already generated a resume for this company + role."""
    records = _load_history()
    for r in records:
        if (r["company"].lower().strip() == company.lower().strip()
                and r["job_title"].lower().strip() == job_title.lower().strip()):
            return True
    return False


def update_status(record_id: int, status: str):
    """Update the status of an application record."""
    valid = ("generated", "applied", "interview", "rejected", "offer")
    if status not in valid:
        raise ValueError(f"Invalid status '{status}'. Must be one of: {', '.join(valid)}")

    records = _load_history()
    for r in records:
        if r["id"] == record_id:
            r["status"] = status
            _save_history(records)
            return
    raise ValueError(f"Record {record_id} not found")


def get_record(record_id: int) -> dict | None:
    """Return a single record by ID."""
    records = _load_history()
    for r in records:
        if r["id"] == record_id:
            return r
    return None


def get_history() -> list[dict]:
    """Return all application records."""
    return _load_history()


def print_history():
    """Pretty-print application history."""
    records = _load_history()
    if not records:
        print("\n  No application history yet.")
        return

    print(f"\n  {'=' * 70}")
    print(f"  APPLICATION HISTORY ({len(records)} records)")
    print(f"  {'=' * 70}")

    # Group by status
    status_order = ["offer", "interview", "applied", "generated", "rejected"]
    for status in status_order:
        group = [r for r in records if r.get("status") == status]
        if not group:
            continue
        print(f"\n  -- {status.upper()} ({len(group)}) --")
        for r in group:
            score = r.get("ats_scores", {}).get("overall", "N/A")
            date = r["timestamp"][:10]
            print(f"    #{r['id']:3d} | {date} | {r['job_title'][:30]:30s} | "
                  f"{r['company'][:20]:20s} | ATS: {score}")

    print(f"\n  {'=' * 70}")

    # Quick stats
    scores = [r["ats_scores"]["overall"] for r in records
              if r.get("ats_scores", {}).get("overall") is not None]
    if scores:
        avg = sum(scores) / len(scores)
        print(f"  Avg ATS Score: {avg:.1f} | Best: {max(scores)} | Total: {len(records)}")
    print()
