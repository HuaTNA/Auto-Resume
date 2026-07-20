"""Claim and run scheduled automations safely from HTTP cron or a worker."""

from datetime import datetime

from sqlalchemy.orm import Session

from api.database import Automation, User
from api.workflows.job_search import execute_automation, run_to_dict
from api.workflows.scheduling import next_run_at


def run_due_automations(db: Session, limit: int = 10) -> list[dict]:
    now = datetime.utcnow()
    candidates = db.query(Automation).filter(
        Automation.enabled.is_(True),
        Automation.next_run_at.is_not(None),
        Automation.next_run_at <= now,
    ).order_by(Automation.next_run_at).limit(max(1, min(limit, 50))).all()
    results = []
    for candidate in candidates:
        claimed_time = candidate.next_run_at
        config = _config(candidate.config_json)
        future = next_run_at(candidate.schedule, now, str(config.get("timezone") or "America/Toronto"))
        claimed = db.query(Automation).filter(
            Automation.id == candidate.id,
            Automation.next_run_at == claimed_time,
        ).update({Automation.next_run_at: future})
        db.commit()
        if claimed != 1:
            continue
        automation = db.query(Automation).filter(Automation.id == candidate.id).first()
        user = db.query(User).filter(User.id == automation.user_id).first()
        if not user:
            continue
        run = execute_automation(db, automation, user, trigger="schedule")
        results.append(run_to_dict(run, automation.public_id))
    return results


def _config(value: str | None) -> dict:
    import json
    try:
        return json.loads(value or "{}")
    except json.JSONDecodeError:
        return {}
