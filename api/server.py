"""
FastAPI backend for AI Resume Generator.
Wraps existing CLI pipeline as REST API endpoints.

Run: uvicorn api.server:app --reload --port 8000
"""

import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session

# Ensure project root is in path
sys.path.insert(0, str(Path(__file__).parent.parent))
load_dotenv()

import anthropic

from src.jd_parser import parse_jd, clean_jd
from src.retriever import retrieve_relevant_content
from src.generator import generate_resume, refine_resume
from src.ats_scorer import score_resume
from src.cover_letter import generate_cover_letter
from src.templates import list_templates
from src.job_finder import search_adzuna, rank_jobs

from api.database import HistoryRecord, Profile, User, get_db, init_db
from api.dependencies import get_current_user
from api.routes.auth import router as auth_router


def _get_cors_origins() -> list[str]:
    """
    Resolve CORS origins from env.
    Priority:
    1) CORS_ORIGINS (comma-separated)
    2) local defaults + optional VERCEL_FRONTEND_URL
    """
    raw = os.environ.get("CORS_ORIGINS", "").strip()
    if raw:
        return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]

    defaults = [
        "http://localhost:3000",
        "http://localhost:3001",
    ]
    vercel_frontend = os.environ.get("VERCEL_FRONTEND_URL", "").strip()
    if vercel_frontend:
        defaults.append(vercel_frontend.rstrip("/"))
    return defaults


def _get_output_root() -> Path:
    """
    Where generated files are written.
    On Vercel, default to /tmp because project files are read-only.
    """
    configured = os.environ.get("OUTPUT_DIR", "").strip()
    if configured:
        return Path(configured)
    if os.environ.get("VERCEL", "").strip() == "1":
        return Path("/tmp/output")
    return Path("output")


app = FastAPI(title="AI Resume Generator API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)


@app.on_event("startup")
def on_startup():
    init_db()


def get_client() -> anthropic.Anthropic:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set")
    return anthropic.Anthropic(api_key=api_key)


# ---------- DB helpers ----------

def _load_profile_db(user: User, db: Session) -> dict:
    """Load profile from DB for the given user. Returns empty dict if none."""
    profile_row = db.query(Profile).filter(Profile.user_id == user.id).first()
    if not profile_row:
        # Auto-create empty profile row
        profile_row = Profile(user_id=user.id, profile_data="{}", updated_at=datetime.utcnow())
        db.add(profile_row)
        db.commit()
        db.refresh(profile_row)
    return profile_row.get_data()


def _save_profile_db(user: User, db: Session, data: dict):
    """Save profile data to DB for the given user."""
    profile_row = db.query(Profile).filter(Profile.user_id == user.id).first()
    if not profile_row:
        profile_row = Profile(user_id=user.id, updated_at=datetime.utcnow())
        db.add(profile_row)
    profile_row.set_data(data)
    profile_row.updated_at = datetime.utcnow()
    db.commit()


def _add_history_db(user: User, db: Session, jd_analysis: dict, ats_scores: dict = None,
                    output_files: list = None, template: str = None,
                    resume_tex: str = None, cover_letter: str = None) -> dict:
    """Insert a history record for the given user. Returns the record dict."""
    record = HistoryRecord(
        user_id=user.id,
        timestamp=datetime.now().isoformat(),
        job_title=jd_analysis.get("job_title", "Unknown"),
        company=jd_analysis.get("company", "Unknown"),
        seniority=jd_analysis.get("seniority", ""),
        required_skills=json.dumps(jd_analysis.get("required_skills", [])),
        template=template or "classic",
        ats_scores=json.dumps({
            "overall": ats_scores.get("semantic", {}).get("overall_score") if ats_scores else None,
            "keyword_pct": ats_scores.get("keyword_match", {}).get("score") if ats_scores else None,
            "relevance": ats_scores.get("semantic", {}).get("relevance_score") if ats_scores else None,
            "impact": ats_scores.get("semantic", {}).get("impact_score") if ats_scores else None,
        }),
        output_files=json.dumps(output_files or []),
        resume_tex=resume_tex or "",
        cover_letter=cover_letter or "",
        status="generated",
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record.to_dict()


def _is_duplicate_db(user: User, db: Session, company: str, job_title: str) -> bool:
    """Check if the user already generated a resume for this company+role."""
    return db.query(HistoryRecord).filter(
        HistoryRecord.user_id == user.id,
        HistoryRecord.company == company,
        HistoryRecord.job_title == job_title,
    ).first() is not None


# ========== Request/Response Models ==========

class JDInput(BaseModel):
    jd_text: str
    template: str = "classic"
    top_k: int = 12
    generate_cover_letter: bool = True


class RefineInput(BaseModel):
    resume_tex: str
    ats_feedback: dict
    jd_analysis: dict


class JobSearchInput(BaseModel):
    query: str
    location: str = "canada"
    max_results: int = 20
    top_n: int = 10


class StatusUpdate(BaseModel):
    status: str


# ========== Endpoints ==========

@app.get("/")
def root():
    return {
        "name": "AI Resume Generator API",
        "status": "ok",
        "health": "/api/health",
        "docs": "/docs",
    }


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/profile")
def get_profile(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get current user profile."""
    profile = _load_profile_db(current_user, db)
    total_bullets = sum(len(e.get("bullets", [])) for e in profile.get("experiences", []))
    total_bullets += sum(len(p.get("bullets", [])) for p in profile.get("projects", []))
    return {
        "profile": profile,
        "stats": {
            "experiences": len(profile.get("experiences", [])),
            "projects": len(profile.get("projects", [])),
            "total_bullets": total_bullets,
        },
    }


@app.put("/api/profile")
def update_profile(
    data: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update entire profile."""
    _save_profile_db(current_user, db, data)
    return {"ok": True}


PROFILE_JSON_PATH = Path(__file__).parent.parent / "data" / "profile.json"


@app.post("/api/profile/import-file")
def import_profile_from_file(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Import profile from data/profile.json into the current user's DB profile."""
    if not PROFILE_JSON_PATH.exists():
        raise HTTPException(status_code=404, detail="data/profile.json not found")

    try:
        file_data = json.loads(PROFILE_JSON_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        raise HTTPException(status_code=400, detail=f"Failed to read profile.json: {e}")

    _save_profile_db(current_user, db, file_data)

    total_bullets = sum(len(e.get("bullets", [])) for e in file_data.get("experiences", []))
    total_bullets += sum(len(p.get("bullets", [])) for p in file_data.get("projects", []))

    return {
        "ok": True,
        "imported": {
            "experiences": len(file_data.get("experiences", [])),
            "projects": len(file_data.get("projects", [])),
            "total_bullets": total_bullets,
        },
    }


@app.put("/api/profile/personal")
def update_personal(
    data: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update personal info only."""
    profile = _load_profile_db(current_user, db)
    profile["personal"] = data
    _save_profile_db(current_user, db, profile)
    return {"ok": True}


@app.put("/api/profile/education")
def update_education(
    data: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update education entries."""
    profile = _load_profile_db(current_user, db)
    profile["education"] = data.get("education", [])
    _save_profile_db(current_user, db, profile)
    return {"ok": True}


@app.put("/api/profile/skills")
def update_skills(
    data: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update skills."""
    profile = _load_profile_db(current_user, db)
    profile["skills"] = data
    _save_profile_db(current_user, db, profile)
    return {"ok": True}


@app.post("/api/profile/experience")
def add_experience(
    data: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Add a new experience entry."""
    profile = _load_profile_db(current_user, db)
    profile.setdefault("experiences", []).append(data)
    _save_profile_db(current_user, db, profile)
    return {"ok": True, "total": len(profile["experiences"])}


@app.put("/api/profile/experience/{exp_id}")
def update_experience(
    exp_id: str,
    data: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update an existing experience entry."""
    profile = _load_profile_db(current_user, db)
    for i, exp in enumerate(profile.get("experiences", [])):
        if exp.get("id") == exp_id:
            profile["experiences"][i] = data
            _save_profile_db(current_user, db, profile)
            return {"ok": True}
    raise HTTPException(status_code=404, detail=f"Experience {exp_id} not found")


@app.delete("/api/profile/experience/{exp_id}")
def delete_experience(
    exp_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete an experience entry."""
    profile = _load_profile_db(current_user, db)
    profile["experiences"] = [e for e in profile.get("experiences", []) if e.get("id") != exp_id]
    _save_profile_db(current_user, db, profile)
    return {"ok": True}


@app.post("/api/profile/project")
def add_project(
    data: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Add a new project entry."""
    profile = _load_profile_db(current_user, db)
    profile.setdefault("projects", []).append(data)
    _save_profile_db(current_user, db, profile)
    return {"ok": True, "total": len(profile["projects"])}


@app.put("/api/profile/project/{proj_id}")
def update_project(
    proj_id: str,
    data: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update an existing project entry."""
    profile = _load_profile_db(current_user, db)
    for i, proj in enumerate(profile.get("projects", [])):
        if proj.get("id") == proj_id:
            profile["projects"][i] = data
            _save_profile_db(current_user, db, profile)
            return {"ok": True}
    raise HTTPException(status_code=404, detail=f"Project {proj_id} not found")


@app.delete("/api/profile/project/{proj_id}")
def delete_project(
    proj_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a project entry."""
    profile = _load_profile_db(current_user, db)
    profile["projects"] = [p for p in profile.get("projects", []) if p.get("id") != proj_id]
    _save_profile_db(current_user, db, profile)
    return {"ok": True}


@app.get("/api/templates")
def get_templates(current_user: User = Depends(get_current_user)):
    """List available resume templates."""
    return {"templates": list_templates()}


@app.post("/api/parse-jd")
def api_parse_jd(
    data: JDInput,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Parse a job description and return structured analysis."""
    client = get_client()
    original_len = len(data.jd_text)
    cleaned = clean_jd(data.jd_text)
    noise_removed = original_len - len(cleaned)

    jd_analysis = parse_jd(cleaned, client)

    duplicate = _is_duplicate_db(
        current_user, db,
        jd_analysis.get("company", ""),
        jd_analysis.get("job_title", ""),
    )

    return {
        "jd_analysis": jd_analysis,
        "noise_removed": noise_removed,
        "noise_pct": noise_removed * 100 // original_len if original_len > 0 else 0,
        "is_duplicate": duplicate,
    }


@app.post("/api/retrieve-bullets")
def api_retrieve_bullets(
    data: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Retrieve relevant bullets from profile for the JD."""
    client = get_client()
    profile = _load_profile_db(current_user, db)
    jd_analysis = data.get("jd_analysis", {})
    top_k = data.get("top_k", 12)

    filtered = retrieve_relevant_content(profile, jd_analysis, client, top_k=top_k)

    total_selected = sum(len(e["bullets"]) for e in filtered.get("experiences", []))
    total_selected += sum(len(p["bullets"]) for p in filtered.get("projects", []))

    return {
        "filtered_profile": filtered,
        "total_selected": total_selected,
    }


@app.post("/api/generate")
def api_generate(
    data: dict,
    current_user: User = Depends(get_current_user),
):
    """Generate resume (and optionally cover letter) from filtered profile + JD."""
    client = get_client()
    filtered_profile = data.get("filtered_profile", {})
    jd_analysis = data.get("jd_analysis", {})
    template_name = data.get("template", "classic")
    gen_cover_letter = data.get("generate_cover_letter", True)

    resume_tex = generate_resume(filtered_profile, jd_analysis, client,
                                 template_name=template_name)

    cover_letter = None
    if gen_cover_letter:
        cover_letter = generate_cover_letter(filtered_profile, jd_analysis, client)

    return {
        "resume_tex": resume_tex,
        "cover_letter": cover_letter,
    }


@app.post("/api/score")
def api_score(
    data: dict,
    current_user: User = Depends(get_current_user),
):
    """Score resume with ATS analysis."""
    client = get_client()
    resume_tex = data.get("resume_tex", "")
    jd_analysis = data.get("jd_analysis", {})

    result = score_resume(resume_tex, jd_analysis, client)
    return {"ats_result": result}


@app.post("/api/refine")
def api_refine(
    data: dict,
    current_user: User = Depends(get_current_user),
):
    """Refine resume based on ATS feedback."""
    client = get_client()
    resume_tex = data.get("resume_tex", "")
    ats_feedback = data.get("ats_feedback", {})
    jd_analysis = data.get("jd_analysis", {})
    filtered_profile = data.get("filtered_profile", {})

    refined = refine_resume(resume_tex, ats_feedback, jd_analysis, filtered_profile, client)
    return {"resume_tex": refined}


@app.post("/api/generate-full")
def api_generate_full(
    data: JDInput,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Full pipeline: parse JD -> retrieve bullets -> generate resume -> ATS score loop.
    Returns everything in one call.
    """
    client = get_client()
    profile = _load_profile_db(current_user, db)

    # Step 1: Clean & parse JD
    cleaned_jd = clean_jd(data.jd_text)
    jd_analysis = parse_jd(cleaned_jd, client)

    # Step 2: Retrieve bullets
    filtered_profile = retrieve_relevant_content(
        profile, jd_analysis, client, top_k=data.top_k
    )

    # Step 3: Generate resume
    resume_tex = generate_resume(filtered_profile, jd_analysis, client,
                                 template_name=data.template)

    # Step 4: ATS scoring + refinement loop
    thresholds = {"overall": 80, "keyword_pct": 60, "relevance": 80, "impact": 80}
    max_rounds = 3
    rounds = []

    for round_num in range(1, max_rounds + 1):
        ats_result = score_resume(resume_tex, jd_analysis, client)
        kw = ats_result["keyword_match"]
        sem = ats_result["semantic"]

        rounds.append({
            "round": round_num,
            "overall": sem["overall_score"],
            "keyword_pct": kw["score"],
            "relevance": sem["relevance_score"],
            "impact": sem["impact_score"],
        })

        passed = (
            sem["overall_score"] >= thresholds["overall"]
            and kw["score"] >= thresholds["keyword_pct"]
            and sem["relevance_score"] >= thresholds["relevance"]
            and sem["impact_score"] >= thresholds["impact"]
        )

        if passed or round_num == max_rounds:
            break

        resume_tex = refine_resume(
            resume_tex, ats_result, jd_analysis, filtered_profile, client
        )

    # Step 5: Cover letter
    cover_letter = None
    if data.generate_cover_letter:
        cover_letter = generate_cover_letter(filtered_profile, jd_analysis, client)

    # Save output files under OUTPUT_DIR/{user_id}/
    output_dir = _get_output_root() / str(current_user.id)
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    raw_title = jd_analysis.get("job_title", "resume")
    job_title_slug = re.sub(r"[^a-zA-Z0-9]+", "_", raw_title).strip("_").lower()
    base = output_dir / f"{timestamp}_{job_title_slug}"

    files = []
    tex_file = str(base) + ".tex"
    with open(tex_file, "w", encoding="utf-8") as f:
        f.write(resume_tex)
    files.append(tex_file)

    txt_file = str(base) + ".txt"
    with open(txt_file, "w", encoding="utf-8") as f:
        f.write(resume_tex)
    files.append(txt_file)

    if cover_letter:
        cl_file = str(base) + "_cover_letter.txt"
        with open(cl_file, "w", encoding="utf-8") as f:
            f.write(cover_letter)
        files.append(cl_file)

    record = _add_history_db(
        current_user, db,
        jd_analysis=jd_analysis,
        ats_scores=ats_result,
        output_files=files,
        template=data.template,
        resume_tex=resume_tex,
        cover_letter=cover_letter or "",
    )

    return {
        "jd_analysis": jd_analysis,
        "filtered_profile": filtered_profile,
        "resume_tex": resume_tex,
        "cover_letter": cover_letter,
        "ats_result": ats_result,
        "optimization_rounds": rounds,
        "record_id": record["id"],
        "files": files,
    }


@app.get("/api/history")
def api_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get application history for the current user."""
    db_records = (
        db.query(HistoryRecord)
        .filter(HistoryRecord.user_id == current_user.id)
        .order_by(HistoryRecord.id.desc())
        .all()
    )
    records = [r.to_dict() for r in db_records]

    light_records = []
    for r in records:
        lr = {k: v for k, v in r.items() if k not in ("resume_tex", "cover_letter")}
        lr["has_resume"] = bool(r.get("resume_tex"))
        lr["has_cover_letter"] = bool(r.get("cover_letter"))
        light_records.append(lr)

    scores = [r["ats_scores"]["overall"] for r in records
              if r.get("ats_scores", {}).get("overall") is not None]
    stats = {
        "total": len(records),
        "avg_score": round(sum(scores) / len(scores), 1) if scores else 0,
        "best_score": max(scores) if scores else 0,
        "by_status": {},
    }
    for r in records:
        s = r.get("status", "generated")
        stats["by_status"][s] = stats["by_status"].get(s, 0) + 1

    return {"records": light_records, "stats": stats}


@app.get("/api/history/{record_id}")
def api_get_record(
    record_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get a single history record with full content."""
    record = db.query(HistoryRecord).filter(
        HistoryRecord.id == record_id,
        HistoryRecord.user_id == current_user.id,
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail=f"Record {record_id} not found")
    return {"record": record.to_dict()}


@app.patch("/api/history/{record_id}")
def api_update_history(
    record_id: int,
    data: StatusUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update application status."""
    valid = ("generated", "applied", "interview", "rejected", "offer")
    if data.status not in valid:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status '{data.status}'. Must be one of: {', '.join(valid)}"
        )

    record = db.query(HistoryRecord).filter(
        HistoryRecord.id == record_id,
        HistoryRecord.user_id == current_user.id,
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail=f"Record {record_id} not found")

    record.status = data.status
    db.commit()
    return {"ok": True}


@app.post("/api/history")
def api_add_history(
    data: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Save a generation record to history."""
    record = _add_history_db(
        current_user, db,
        jd_analysis=data.get("jd_analysis", {}),
        ats_scores=data.get("ats_scores", {}),
        template=data.get("template", "classic"),
        resume_tex=data.get("resume_tex", ""),
        cover_letter=data.get("cover_letter", ""),
    )
    return {"ok": True, "record": record}


def _compile_tex_to_pdf(tex_content: str) -> dict:
    """Compile LaTeX string to PDF, return dict with ok/pdf_base64/error."""
    import base64
    import subprocess
    import tempfile

    with tempfile.TemporaryDirectory() as tmpdir:
        tex_path = Path(tmpdir) / "document.tex"
        tex_path.write_text(tex_content, encoding="utf-8")

        try:
            result = subprocess.run(
                ["pdflatex", "-interaction=nonstopmode", "-output-directory", tmpdir, str(tex_path)],
                capture_output=True, text=True, timeout=30, cwd=tmpdir
            )
            pdf_path = Path(tmpdir) / "document.pdf"
            if not pdf_path.exists():
                return {"ok": False, "error": "PDF compilation failed", "log": result.stdout[-2000:]}

            pdf_bytes = pdf_path.read_bytes()
            return {
                "ok": True,
                "pdf_base64": base64.b64encode(pdf_bytes).decode("ascii"),
                "size": len(pdf_bytes),
            }
        except FileNotFoundError:
            return {"ok": False, "error": "pdflatex not found. Install TeX Live or MiKTeX."}
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "PDF compilation timed out"}


def _wrap_cover_letter_tex(text: str) -> str:
    """Wrap plain-text cover letter in a clean LaTeX template."""
    replacements = [
        ("\\", "\\textbackslash{}"),
        ("&", "\\&"), ("%", "\\%"), ("$", "\\$"), ("#", "\\#"),
        ("_", "\\_"), ("{", "\\{"), ("}", "\\}"),
        ("~", "\\textasciitilde{}"), ("^", "\\textasciicircum{}"),
    ]
    escaped = text
    for old, new in replacements:
        escaped = escaped.replace(old, new)

    paragraphs = escaped.split("\n\n")
    body = "\n\n".join(p.strip() for p in paragraphs if p.strip())

    return r"""\documentclass[11pt,letterpaper]{article}
\usepackage[margin=1in]{geometry}
\usepackage{parskip}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\pagestyle{empty}

\begin{document}

""" + body + r"""

\end{document}
"""


@app.post("/api/compile-pdf")
def api_compile_pdf(
    data: dict,
    current_user: User = Depends(get_current_user),
):
    """Compile LaTeX to PDF and return as base64."""
    resume_tex = data.get("resume_tex", "")
    if not resume_tex:
        raise HTTPException(status_code=400, detail="No LaTeX content provided")

    result = _compile_tex_to_pdf(resume_tex)
    if not result["ok"]:
        if "not found" in result.get("error", ""):
            raise HTTPException(status_code=500, detail=result["error"])
    return result


@app.post("/api/compile-cover-letter-pdf")
def api_compile_cover_letter_pdf(
    data: dict,
    current_user: User = Depends(get_current_user),
):
    """Compile plain-text cover letter to PDF."""
    cover_letter = data.get("cover_letter", "")
    if not cover_letter:
        raise HTTPException(status_code=400, detail="No cover letter content provided")

    tex = _wrap_cover_letter_tex(cover_letter)
    result = _compile_tex_to_pdf(tex)
    if not result["ok"]:
        if "not found" in result.get("error", ""):
            raise HTTPException(status_code=500, detail=result["error"])
    return result


@app.post("/api/search-jobs")
def api_search_jobs(
    data: JobSearchInput,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Search for jobs and rank by profile fit."""
    app_id = os.environ.get("ADZUNA_APP_ID", "")
    app_key = os.environ.get("ADZUNA_APP_KEY", "")
    if not app_id or not app_key:
        raise HTTPException(
            status_code=400,
            detail="ADZUNA_APP_ID and ADZUNA_APP_KEY must be set in .env"
        )

    client = get_client()
    profile = _load_profile_db(current_user, db)

    jobs = search_adzuna(
        query=data.query,
        location=data.location,
        app_id=app_id,
        app_key=app_key,
        max_results=data.max_results,
    )

    if not jobs:
        return {"jobs": [], "total": 0}

    ranked = rank_jobs(jobs, profile, client, top_n=data.top_n)
    return {"jobs": ranked, "total": len(ranked)}
