"""End-to-end career discovery workflow with a human approval boundary."""

import hashlib
import json
import os
from datetime import datetime
from uuid import uuid4

import anthropic
from sqlalchemy.orm import Session

from api.database import (
    Automation, AutomationRun, CareerApplication, CareerJob, CareerJobMatch,
    Document, DocumentVersion, HistoryRecord, Notification, Profile,
    RecommendationBatch, RecommendationBatchItem, User, WorkspaceActivity,
)
from api.workflows.application_agent import digest, ensure_agent
from api.workflows.scheduling import next_run_at
from api.workflows.job_retention import (
    cleanup_expired_jobs, job_is_expired, job_retention_days, parse_job_posted_at,
)
from api.limits import enforce_external_api_limit
from src.cover_letter import generate_cover_letter
from src.career_search_agent import (
    execute_search_plan, fallback_search_plan, plan_career_search,
)
from src.job_finder import rank_jobs, search_jobs
from src.material_pipeline import run_material_pipeline
from src.retriever import retrieve_relevant_content


def execute_automation(db: Session, automation: Automation, user: User,
                       trigger: str = "manual") -> AutomationRun:
    cleanup_expired_jobs(db, user.id)
    db.commit()
    run = AutomationRun(
        public_id=str(uuid4()), automation_id=automation.id, user_id=user.id,
        status="running", trigger=trigger, started_at=datetime.utcnow(),
    )
    db.add(run); db.commit(); db.refresh(run)

    attempts = max(1, min((automation.max_retries or 0) + 1, 4))
    last_error = None
    for attempt in range(1, attempts + 1):
        run.attempt_count = attempt
        try:
            if automation.kind == "workspace_snapshot":
                counts, result = _workspace_snapshot(db, user)
            elif automation.kind == "job_search":
                counts, result = _job_search_pipeline(db, automation, run, user)
            else:
                raise RuntimeError(f"Unsupported automation kind: {automation.kind}")
            run.status, run.error = "completed", None
            run.counts_json, run.result_json = _dump(counts), _dump(result)
            _notify(db, user.id, "automation_completed", f"{automation.name} completed", _completion_message(counts), "/automations")
            break
        except Exception as exc:
            db.rollback()
            run = db.query(AutomationRun).filter(AutomationRun.id == run.id).first()
            last_error = f"{type(exc).__name__}: {exc}"
            run.attempt_count = attempt
            if attempt == attempts:
                run.status, run.error = "failed", last_error[:2000]
                _notify(db, user.id, "automation_failed", f"{automation.name} failed", run.error, "/automations")

    run.finished_at = datetime.utcnow()
    automation.last_run_at = run.finished_at
    config = _load(automation.config_json, {})
    automation.next_run_at = next_run_at(automation.schedule, run.finished_at, str(config.get("timezone") or "America/Toronto"))
    db.commit(); db.refresh(run)
    return run


def run_to_dict(run: AutomationRun, automation_public_id: str | None = None) -> dict:
    return {
        "id": run.public_id, "automation_id": automation_public_id,
        "status": run.status, "trigger": run.trigger,
        "attempt_count": run.attempt_count,
        "counts": _load(run.counts_json, {}),
        "result": _load(run.result_json, {}), "error": run.error,
        "started_at": _iso(run.started_at), "finished_at": _iso(run.finished_at),
        "created_at": _iso(run.created_at),
    }


def generate_application_materials(db: Session, user: User,
                                   application: CareerApplication, *,
                                   target_ats_score: int = 85,
                                   max_optimization_rounds: int = 2,
                                   template: str | None = None) -> HistoryRecord:
    job = db.query(CareerJob).filter(CareerJob.id == application.job_id, CareerJob.user_id == user.id).first()
    if not job:
        raise RuntimeError("Job not found")
    profile_row = db.query(Profile).filter(Profile.user_id == user.id).first()
    profile = profile_row.get_data() if profile_row else {}
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not configured")
    history = db.query(HistoryRecord).filter(HistoryRecord.id == application.history_record_id).first()
    if history and history.resume_tex:
        return history
    client = anthropic.Anthropic(api_key=api_key)
    _generate_materials(
        db, user, job, application, profile, client,
        template or (history.template if history else "classic"),
        target_ats_score=target_ats_score,
        max_optimization_rounds=max_optimization_rounds,
    )
    _notify(db, user.id, "materials_ready", f"Materials ready for {job.title}",
            f"Review the resume and cover letter for {job.company} before applying.",
            "/career/applications")
    db.commit()
    return db.query(HistoryRecord).filter(HistoryRecord.id == application.history_record_id).first()


def ensure_application_for_job(db: Session, user: User, job: CareerJob) -> CareerApplication:
    """Create the review boundary needed for a user-selected job, if absent."""
    application = db.query(CareerApplication).filter(
        CareerApplication.user_id == user.id,
        CareerApplication.job_id == job.id,
    ).first()
    if application:
        return application

    latest_match = db.query(CareerJobMatch).filter(
        CareerJobMatch.user_id == user.id,
        CareerJobMatch.job_id == job.id,
    ).order_by(CareerJobMatch.id.desc()).first()
    match_score = int(latest_match.match_score or 0) if latest_match else 0
    history = HistoryRecord(
        user_id=user.id, timestamp=datetime.now().isoformat(),
        job_title=job.title, company=job.company, seniority="",
        required_skills="[]", template="classic",
        ats_scores="{}", output_files="[]",
        resume_tex="", cover_letter="", status="suggested",
    )
    db.add(history); db.flush()
    application = CareerApplication(
        public_id=str(uuid4()), user_id=user.id, job_id=job.id,
        history_record_id=history.id, status="suggested",
        approval_status="pending", match_score=match_score,
        automation_id=latest_match.automation_id if latest_match else None,
    )
    db.add(application); db.flush()
    _activity(db, user.id, application.public_id, f"Review {job.title} at {job.company}")
    return application


def _workspace_snapshot(db: Session, user: User) -> tuple[dict, dict]:
    from api.database import KnowledgeItem, WorkspaceProject, WorkspaceTask
    counts = {
        "projects": db.query(WorkspaceProject).filter(WorkspaceProject.user_id == user.id).count(),
        "open_tasks": db.query(WorkspaceTask).filter(WorkspaceTask.user_id == user.id, WorkspaceTask.status == "todo").count(),
        "knowledge": db.query(KnowledgeItem).filter(KnowledgeItem.user_id == user.id).count(),
    }
    return counts, {}


def _job_search_pipeline(db: Session, automation: Automation, run: AutomationRun,
                         user: User) -> tuple[dict, dict]:
    config = _load(automation.config_json, {})
    query = str(config.get("query") or automation.name).strip()
    location = str(config.get("location") or "canada").strip()
    max_results = _bounded(config.get("max_results"), 20, 1, 50)
    top_n = _bounded(config.get("top_n"), 10, 1, 20)
    min_score = _bounded(config.get("min_match_score"), 60, 0, 100)
    configured_sources = config.get("sources", ["indeed", "adzuna"])
    if not isinstance(configured_sources, list):
        configured_sources = ["indeed", "adzuna"]
    sources = [source for source in configured_sources if source in {"indeed", "adzuna"}]
    if not sources:
        sources = ["indeed", "adzuna"]
    app_id, app_key = os.environ.get("ADZUNA_APP_ID", "").strip(), os.environ.get("ADZUNA_APP_KEY", "").strip()
    profile_row = db.query(Profile).filter(Profile.user_id == user.id).first()
    profile = profile_row.get_data() if profile_row else {}
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    client = anthropic.Anthropic(api_key=api_key) if api_key else None

    agent_enabled = bool(config.get("agent_enabled", True))
    max_queries = _bounded(config.get("max_search_queries"), 3, 1, 5)
    plan = fallback_search_plan(query)
    planning_warning = None
    if agent_enabled and client is not None:
        try:
            plan = plan_career_search(
                profile, query, location, client, max_queries=max_queries,
            )
        except Exception as exc:
            planning_warning = f"AI search planning unavailable: {type(exc).__name__}"
    elif agent_enabled:
        planning_warning = "AI search planning is not configured; using the seed query."

    enforce_external_api_limit(
        db, user, units=max(1, len(sources) * len(plan.queries)), check_burst=False,
    )
    jobs, source_warnings = execute_search_plan(
        plan, search_jobs, location=location, sources=sources, app_id=app_id,
        app_key=app_key, max_results=max_results,
    )
    retention_now = datetime.utcnow()
    retained_jobs = [job for job in jobs if not job_is_expired(job, retention_now)]
    expired_count = len(jobs) - len(retained_jobs)
    jobs = retained_jobs
    if expired_count:
        source_warnings.append(f"Skipped {expired_count} listing(s) older than {job_retention_days()} days")
    ranking_warning = None
    if jobs and client is not None:
        try:
            jobs = rank_jobs(
                jobs, profile, client, top_n=top_n,
                search_context=plan.to_dict() if agent_enabled else None,
            )
        except Exception as exc:
            ranking_warning = f"AI ranking unavailable: {type(exc).__name__}"
            jobs = jobs[:top_n]
    else:
        jobs = jobs[:top_n]
        ranking_warning = "AI ranking is not configured; using source relevance."
    for job in jobs:
        job.setdefault("match_score", 0)
        source_label = str(job.get("source") or "job board").title()
        job.setdefault("match_reason", f"{source_label} relevance result")

    new_count = duplicate_count = application_count = material_count = 0
    output_jobs = []
    digest_entries: list[tuple[CareerJob, CareerApplication]] = []
    processed_job_ids: set[int] = set()
    generation_limit = _bounded(config.get("max_generate"), 1, 0, 3)
    generate_materials = bool(config.get("generate_materials", False))
    for job_data in jobs:
        source_key = _source_key(job_data)
        job = db.query(CareerJob).filter(CareerJob.user_id == user.id, CareerJob.source_key == source_key).first()
        if not job:
            job = db.query(CareerJob).filter(
                CareerJob.user_id == user.id,
                CareerJob.company == str(job_data.get("company") or "Unknown")[:255],
                CareerJob.title == str(job_data.get("title") or "Unknown")[:255],
            ).first()
            if job and not job.source_key:
                job.source_key = source_key
                job.source = str(job_data.get("source") or "adzuna")
                job.source_url = job.source_url or job_data.get("url")
                job.location = job.location or str(job_data.get("location") or "")[:255]
        is_new = job is None
        if is_new:
            job = CareerJob(
                public_id=str(uuid4()), user_id=user.id, source_key=source_key,
                source=str(job_data.get("source") or "adzuna"),
                title=str(job_data.get("title") or "Unknown")[:255],
                company=str(job_data.get("company") or "Unknown")[:255],
                location=str(job_data.get("location") or "")[:255],
                source_url=job_data.get("url"), jd_text=str(job_data.get("description") or ""),
                source_payload=_dump(job_data), required_skills="[]",
                posted_at=parse_job_posted_at(job_data.get("created")),
            )
            db.add(job); db.flush(); new_count += 1
        else:
            duplicate_count += 1
            posted_at = parse_job_posted_at(job_data.get("created"))
            if posted_at is not None:
                job.posted_at = posted_at

        # Different providers (or slightly different location strings) can
        # resolve to the same canonical CareerJob. Only one match is allowed
        # for a job within a run, so discard later copies before inserting.
        if job.id in processed_job_ids:
            continue
        processed_job_ids.add(job.id)

        match = CareerJobMatch(
            public_id=str(uuid4()), user_id=user.id, automation_id=automation.id,
            run_id=run.id, job_id=job.id, match_score=int(job_data.get("match_score") or 0),
            match_reason=str(job_data.get("match_reason") or ""), is_new=is_new,
        )
        db.add(match)

        application = db.query(CareerApplication).filter(
            CareerApplication.user_id == user.id, CareerApplication.job_id == job.id
        ).first()
        created_application = False
        qualifies = _job_qualifies(job_data.get("match_score"), min_score, ranking_warning)
        if not application and qualifies:
            history = HistoryRecord(
                user_id=user.id, timestamp=datetime.now().isoformat(),
                job_title=job.title, company=job.company, seniority="",
                required_skills="[]", template=str(config.get("template") or "classic"),
                ats_scores="{}",
                output_files="[]", resume_tex="", cover_letter="", status="suggested",
            )
            db.add(history); db.flush()
            application = CareerApplication(
                public_id=str(uuid4()), user_id=user.id, job_id=job.id,
                history_record_id=history.id, status="suggested", approval_status="pending",
                match_score=int(job_data.get("match_score") or 0), automation_id=automation.id,
            )
            db.add(application); db.flush(); application_count += 1
            created_application = True
            _activity(db, user.id, application.public_id, f"Review {job.title} at {job.company}")

        generated = False
        if application and created_application and generate_materials and material_count < generation_limit and not _has_materials(db, application):
            try:
                _generate_materials(db, user, job, application, profile, client, str(config.get("template") or "classic"))
                material_count += 1; generated = True
            except Exception as exc:
                job_data["generation_warning"] = f"{type(exc).__name__}: {exc}"

        output = dict(job_data)
        output.update({"job_id": job.public_id, "is_new": is_new,
                       "application_record_id": application.history_record_id if application else None,
                       "approval_status": application.approval_status if application else None,
                       "materials_generated": generated or (application is not None and _has_materials(db, application))})
        output_jobs.append(output)
        if (application and qualifies and
                application.status in {"suggested", "generated"} and
                len(digest_entries) < 3):
            digest_entries.append((job, application))

    recommendation_batch_id = None
    if digest_entries:
        batch_key = f"automation-run:{run.public_id}"
        batch = db.query(RecommendationBatch).filter(
            RecommendationBatch.user_id == user.id,
            RecommendationBatch.idempotency_key == batch_key,
        ).first()
        if not batch:
            job_ids = [job.public_id for job, _ in digest_entries]
            batch = RecommendationBatch(
                public_id=str(uuid4()), user_id=user.id,
                idempotency_key=batch_key,
                request_hash=digest({"job_ids": job_ids}),
                label=plan.goal, status="ready",
            )
            db.add(batch); db.flush()
            for position, (job, application) in enumerate(digest_entries):
                ensure_agent(db, application)
                db.add(RecommendationBatchItem(
                    public_id=str(uuid4()), batch_id=batch.id, user_id=user.id,
                    job_id=job.id, application_id=application.id,
                    position=position,
                ))
        recommendation_batch_id = batch.public_id

    source_counts = {
        source: sum(1 for job in jobs if job.get("source") == source)
        for source in sources
    }
    counts = {"found": len(jobs), "new_jobs": new_count, "duplicates": duplicate_count,
              "applications": application_count, "materials": material_count,
              **{f"source_{source}": count for source, count in source_counts.items()}}
    return counts, {"query": query, "location": location, "jobs": output_jobs,
                    "recommendation_batch_id": recommendation_batch_id,
                    "sources": sources, "source_warnings": source_warnings,
                    "ranking_warning": ranking_warning,
                    "agent": {
                        "enabled": agent_enabled,
                        "status": "disabled" if not agent_enabled else ("fallback" if planning_warning else "planned"),
                        **plan.to_dict(),
                        "warning": planning_warning,
                    },
                    "approval_required": True}


def _generate_materials(db: Session, user: User, job: CareerJob,
                        application: CareerApplication, profile: dict,
                        client: anthropic.Anthropic | None, template: str, *,
                        target_ats_score: int = 85,
                        max_optimization_rounds: int = 2) -> None:
    if client is None:
        raise RuntimeError("ANTHROPIC_API_KEY is required for document generation")
    if not profile:
        raise RuntimeError("Career profile is empty")
    pipeline = run_material_pipeline(
        profile,
        {
            "title": job.title,
            "company": job.company,
            "url": job.source_url or "",
            "jd_text": job.jd_text,
            "match_reason": "Ranked career match",
        },
        client,
        job_match_score=application.match_score,
        job_match_reason="Ranked career match",
        template_name=template,
        target_ats_score=target_ats_score,
        max_optimization_rounds=max_optimization_rounds,
    )
    resume = pipeline.get("material", {}).get("resume_tex")
    analysis = pipeline.get("job_analysis") or {}
    if not resume or pipeline.get("status") == "failed":
        errors = pipeline.get("errors") or []
        detail = errors[-1].get("message") if errors else "Material pipeline failed"
        raise RuntimeError(str(detail))
    filtered = retrieve_relevant_content(profile, analysis, client, top_k=12)
    cover = generate_cover_letter(filtered, analysis, client)
    ats = pipeline.get("resume_ats") or {}
    history = db.query(HistoryRecord).filter(HistoryRecord.id == application.history_record_id, HistoryRecord.user_id == user.id).first()
    history.resume_tex, history.cover_letter, history.status = resume, cover, "generated"
    history.required_skills = _dump(analysis.get("required_skills", []))
    history.seniority = analysis.get("seniority", "")
    history.ats_scores = _dump({
        "overall": ats.get("overall_score"),
        "keyword_pct": ats.get("keyword_match_score"),
        "relevance": ats.get("relevance_score"),
        "impact": ats.get("impact_score"),
    })
    application.status, application.approval_status = "generated", "ready"
    job.required_skills = history.required_skills
    _index_document(db, user.id, history, "resume", resume, {
        "material_pipeline": {
            "schema_version": pipeline.get("schema_version"),
            "status": pipeline.get("status"),
            "selected_version": pipeline.get("material", {}).get("selected_version"),
            "optimization": pipeline.get("optimization", {}),
            "usage": pipeline.get("usage", {}),
            "warnings": pipeline.get("warnings", []),
            "errors": pipeline.get("errors", []),
        },
    })
    _index_document(db, user.id, history, "cover_letter", cover)


def _index_document(db: Session, user_id: int, history: HistoryRecord,
                    kind: str, content: str, metadata: dict | None = None) -> None:
    document = db.query(Document).filter(Document.user_id == user_id, Document.source_record_id == history.id, Document.kind == kind).first()
    if document:
        return
    document = Document(public_id=str(uuid4()), user_id=user_id,
                        title=f"{history.job_title} · {history.company}", kind=kind,
                        owner_module="career", source_record_id=history.id)
    db.add(document); db.flush()
    db.add(DocumentVersion(public_id=str(uuid4()), document_id=document.id,
                           user_id=user_id, version_number=1, content=content,
                           metadata_json=_dump({"automation": True, **(metadata or {})})))


def _has_materials(db: Session, application: CareerApplication) -> bool:
    history = db.query(HistoryRecord).filter(HistoryRecord.id == application.history_record_id).first()
    return bool(history and history.resume_tex)


def _source_key(job: dict) -> str:
    identity = str(job.get("external_id") or job.get("url") or "|").strip()
    if identity == "|":
        identity = "|".join(str(job.get(key) or "").strip().lower() for key in ("company", "title", "location"))
    return hashlib.sha256(f"{job.get('source', 'adzuna')}|{identity}".encode()).hexdigest()


def _job_qualifies(match_score, min_score: int, ranking_warning: str | None) -> bool:
    """Never create review items from unranked fallback results."""
    if ranking_warning is not None:
        return False
    try:
        return int(match_score or 0) >= min_score
    except (TypeError, ValueError):
        return False


def _notify(db: Session, user_id: int, kind: str, title: str, message: str, href: str) -> None:
    db.add(Notification(public_id=str(uuid4()), user_id=user_id, kind=kind,
                        title=title[:255], message=message[:5000], href=href))


def _activity(db: Session, user_id: int, entity_id: str, title: str) -> None:
    db.add(WorkspaceActivity(public_id=str(uuid4()), user_id=user_id, module="career",
                             action="created", entity_type="application",
                             entity_id=entity_id, title=title[:255]))


def _completion_message(counts: dict) -> str:
    if "new_jobs" in counts:
        return f"Found {counts.get('new_jobs', 0)} new jobs and created {counts.get('applications', 0)} review items."
    return "Workspace snapshot completed."


def _bounded(value, default: int, minimum: int, maximum: int) -> int:
    try: parsed = int(value)
    except (TypeError, ValueError): parsed = default
    return max(minimum, min(parsed, maximum))


def _load(value: str | None, fallback):
    try: return json.loads(value or "")
    except (TypeError, json.JSONDecodeError): return fallback


def _dump(value) -> str:
    return json.dumps(value, ensure_ascii=False)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None
