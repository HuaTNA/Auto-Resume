"""Retention policy for discovered jobs and job-search run payloads."""

import json
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from api.database import Automation, AutomationRun, CareerApplication, CareerJob, CareerJobMatch


DEFAULT_JOB_RETENTION_DAYS = 15


def job_retention_days() -> int:
    """Return the configured retention period, bounded to a safe range."""
    try:
        value = int(os.environ.get("JOB_RETENTION_DAYS", str(DEFAULT_JOB_RETENTION_DAYS)))
    except ValueError:
        value = DEFAULT_JOB_RETENTION_DAYS
    return max(1, min(value, 365))


def parse_job_posted_at(value: object) -> datetime | None:
    """Normalize provider timestamps to a naive UTC datetime."""
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value.strip():
        raw = value.strip()
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            try:
                parsed = datetime.strptime(raw[:10], "%Y-%m-%d")
            except ValueError:
                return None
    else:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def job_is_expired(job_data: dict, now: datetime | None = None) -> bool:
    """Treat provider-dated listings older than the retention window as expired."""
    posted_at = parse_job_posted_at(job_data.get("created"))
    if posted_at is None:
        return False
    return posted_at < (now or datetime.utcnow()) - timedelta(days=job_retention_days())


def cleanup_expired_jobs(db: Session, user_id: int | None = None,
                         now: datetime | None = None) -> dict[str, int]:
    """Remove expired discovery data while retaining compact application history."""
    current = now or datetime.utcnow()
    cutoff = current - timedelta(days=job_retention_days())

    job_query = db.query(CareerJob)
    if user_id is not None:
        job_query = job_query.filter(CareerJob.user_id == user_id)
    # Serialize cleanup for the selected rows. Without this lock, overlapping
    # serverless requests can both load the same jobs and one transaction can
    # delete rows while the other still expects to update them.
    jobs = job_query.with_for_update().all()

    # Backfill provider dates for rows created before posted_at was introduced.
    for job in jobs:
        if job.posted_at is None:
            try:
                payload = json.loads(job.source_payload or "{}")
            except (TypeError, json.JSONDecodeError):
                payload = {}
            job.posted_at = parse_job_posted_at(payload.get("created"))

    # Persist backfilled dates before bulk deletion. Otherwise SQLAlchemy may
    # try to UPDATE dirty CareerJob objects after those rows have been deleted.
    db.flush()

    expired_jobs = [
        job for job in jobs
        if (job.posted_at or job.created_at) < cutoff
    ]
    expired_ids = {job.id for job in expired_jobs}
    expired_public_ids = {job.public_id for job in expired_jobs}

    protected_ids = set()
    if expired_ids:
        protected_ids = {
            row[0] for row in db.query(CareerApplication.job_id).filter(
                CareerApplication.job_id.in_(expired_ids)
            ).all()
        }
    deletable_ids = expired_ids - protected_ids

    run_query = db.query(AutomationRun.id).join(
        Automation, AutomationRun.automation_id == Automation.id
    ).filter(Automation.kind == "job_search", AutomationRun.created_at < cutoff)
    if user_id is not None:
        run_query = run_query.filter(AutomationRun.user_id == user_id)
    expired_run_ids = {row[0] for row in run_query.all()}

    matches_deleted = 0
    if expired_run_ids:
        matches_deleted += db.query(CareerJobMatch).filter(
            CareerJobMatch.run_id.in_(expired_run_ids)
        ).delete(synchronize_session=False)
        db.query(AutomationRun).filter(
            AutomationRun.id.in_(expired_run_ids)
        ).delete(synchronize_session=False)

    # A recent run can contain an already-old provider listing. Remove it from
    # the JSON payload as well so the Jobs page cannot resurrect expired cards.
    payloads_pruned = 0
    if expired_public_ids:
        recent_runs = db.query(AutomationRun).join(
            Automation, AutomationRun.automation_id == Automation.id
        ).filter(Automation.kind == "job_search")
        if user_id is not None:
            recent_runs = recent_runs.filter(AutomationRun.user_id == user_id)
        for run in recent_runs.all():
            try:
                result = json.loads(run.result_json or "{}")
            except (TypeError, json.JSONDecodeError):
                continue
            result_jobs = result.get("jobs")
            if not isinstance(result_jobs, list):
                continue
            retained = [item for item in result_jobs if item.get("job_id") not in expired_public_ids]
            if len(retained) != len(result_jobs):
                result["jobs"] = retained
                run.result_json = json.dumps(result, ensure_ascii=False)
                payloads_pruned += len(result_jobs) - len(retained)

    if deletable_ids:
        matches_deleted += db.query(CareerJobMatch).filter(
            CareerJobMatch.job_id.in_(deletable_ids)
        ).delete(synchronize_session=False)
        db.query(CareerJob).filter(
            CareerJob.id.in_(deletable_ids)
        ).delete(synchronize_session=False)

    compacted = 0
    for job in expired_jobs:
        if job.id in protected_ids:
            if job.jd_text or job.source_payload not in ("", "{}"):
                compacted += 1
            job.jd_text = ""
            job.source_payload = "{}"

    db.flush()
    return {
        "jobs_deleted": len(deletable_ids),
        "jobs_compacted": compacted,
        "runs_deleted": len(expired_run_ids),
        "matches_deleted": matches_deleted,
        "payload_jobs_pruned": payloads_pruned,
    }
