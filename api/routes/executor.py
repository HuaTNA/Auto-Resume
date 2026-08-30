"""Private, user-bound delivery port for the local application executor.

Claims are single-use, not expiring leases: an interrupted external action must
never be automatically replayed. The existing callback API records the outcome.
"""
import hmac
import json
import os
from datetime import datetime, timedelta
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from api.database import ApplicationAgent, CareerJob, Integration, Notification, SubmissionReceipt, User, get_db
from api.workflows.application_agent import application_and_history, content_snapshot, current_approved_snapshot

router = APIRouter(prefix="/api/internal/executor", tags=["application-executor"])


def executor_user(
    authorization: str = Header(default=""),
    callback_secret: str = Header(default="", alias="X-Internal-Callback-Secret"),
    discord_user: str = Header(default="", alias="X-Discord-User-Id"),
    db: Session = Depends(get_db),
):
    service = os.environ.get("AUTO_RESUME_SERVICE_TOKEN", "").strip()
    callback = os.environ.get("AGENT_CALLBACK_SECRET", "").strip()
    if (not service or not callback or not hmac.compare_digest(authorization, f"Bearer {service}")
            or not hmac.compare_digest(callback_secret, callback)):
        raise HTTPException(401, "Invalid executor credentials")
    bindings = db.query(Integration).filter_by(provider="discord", state="connected", external_account=discord_user).limit(2).all()
    if len(bindings) != 1:
        raise HTTPException(401, "Executor requires one connected Discord identity")
    user = db.query(User).filter_by(id=bindings[0].user_id).first()
    if not user:
        raise HTTPException(401, "Executor user not found")
    return user


class Claim(BaseModel):
    worker_id: str = Field(min_length=16, max_length=100, pattern=r"^[a-zA-Z0-9-]+$")


class ValidateClaim(Claim):
    fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    content_digest: str = Field(pattern=r"^[a-f0-9]{64}$")
    job_url: str = Field(min_length=1, max_length=4000)


class Heartbeat(Claim):
    dry_run: bool = True


def executor_status(db: Session, user_id: int) -> dict:
    row = db.query(Integration).filter_by(user_id=user_id, provider="application-executor").first()
    connected = bool(row and row.updated_at and row.updated_at > datetime.utcnow() - timedelta(seconds=120))
    config = json.loads(row.config_json or "{}") if row else {}
    return {"connected": connected, "dry_run": config.get("dry_run", True),
            "last_seen": row.updated_at.isoformat() if row else None}


@router.post("/heartbeat")
def heartbeat(data: Heartbeat, user: User = Depends(executor_user), db: Session = Depends(get_db)):
    row = db.query(Integration).filter_by(user_id=user.id, provider="application-executor").first()
    if not row:
        row = Integration(public_id=str(uuid4()), user_id=user.id, provider="application-executor", scopes="[]")
        db.add(row)
    row.state, row.external_account = "connected", data.worker_id
    row.config_json = json.dumps({"dry_run": data.dry_run})
    row.updated_at = datetime.utcnow()
    db.commit()
    return executor_status(db, user.id)


@router.get("/notifications")
def notifications(after: int | None = Query(default=None, ge=0), user: User = Depends(executor_user), db: Session = Depends(get_db)):
    query = db.query(Notification).filter(Notification.user_id == user.id,
        Notification.kind.in_(["automation_completed", "automation_failed", "materials_ready"]))
    if after is None:
        latest = query.order_by(Notification.id.desc()).first()
        return {"notifications": [], "cursor": latest.id if latest else 0}
    rows = query.filter(Notification.id > after).order_by(Notification.id).limit(10).all()
    return {"notifications": [{"title": row.title, "message": row.message, "href": row.href,
                               "kind": row.kind} for row in rows], "cursor": rows[-1].id if rows else after}


@router.get("/queue")
def queue(user: User = Depends(executor_user), db: Session = Depends(get_db)):
    rows = db.query(SubmissionReceipt).filter_by(user_id=user.id, status="queued").order_by(SubmissionReceipt.id).limit(10).all()
    return {"receipts": [{"id": row.public_id, "created_at": row.created_at.isoformat()} for row in rows]}


def _owned_receipt(db, user, public_id):
    row = db.query(SubmissionReceipt).filter_by(user_id=user.id, public_id=public_id).first()
    if not row:
        raise HTTPException(404, "Submission receipt not found")
    return row


def _approved_dispatch(db, row):
    agent = db.query(ApplicationAgent).filter_by(id=row.agent_id, user_id=row.user_id).first()
    if not agent or agent.state != "submitting":
        raise HTTPException(409, "Application is no longer submitting")
    approval = current_approved_snapshot(db, agent)
    if approval.id != row.approval_id:
        raise HTTPException(409, "Receipt does not reference the current approval")
    application, _ = application_and_history(db, agent)
    job = db.query(CareerJob).filter_by(id=application.job_id, user_id=row.user_id).first()
    if not job or not job.source_url:
        raise HTTPException(409, "Application has no source URL")
    return agent, approval, job


@router.post("/receipts/{public_id}/claim")
def claim(public_id: str, data: Claim, user: User = Depends(executor_user), db: Session = Depends(get_db)):
    row = _owned_receipt(db, user, public_id)
    agent, approval, job = _approved_dispatch(db, row)
    # Atomic status predicate prevents two processes from operating the same form.
    changed = db.query(SubmissionReceipt).filter_by(id=row.id, user_id=user.id, status="queued").update({
        "status": "accepted", "updated_at": datetime.utcnow(),
        "metadata_json": json.dumps({"worker_id": data.worker_id, "job_url": job.source_url}),
    }, synchronize_session=False)
    if changed != 1:
        db.rollback()
        raise HTTPException(409, "Receipt was already claimed; do not replay external actions")
    snapshot = content_snapshot(db, agent)
    db.commit()
    return {"receipt_id": row.public_id, "agent_id": agent.public_id,
            "approval_id": approval.public_id, "content_digest": approval.content_digest,
            "job_url": job.source_url, "snapshot": snapshot}


@router.post("/receipts/{public_id}/validate")
def validate(public_id: str, data: ValidateClaim, user: User = Depends(executor_user), db: Session = Depends(get_db)):
    row = _owned_receipt(db, user, public_id)
    meta = json.loads(row.metadata_json or "{}")
    if row.status != "accepted" or meta.get("worker_id") != data.worker_id:
        raise HTTPException(409, "Executor claim is not active")
    _, approval, job = _approved_dispatch(db, row)
    if (approval.content_digest != data.content_digest or job.source_url != data.job_url
            or meta.get("job_url") != data.job_url):
        raise HTTPException(409, "Approved content or destination changed")
    if meta.get("fingerprint") not in (None, data.fingerprint):
        raise HTTPException(409, "Execution fingerprint changed")
    meta["fingerprint"] = data.fingerprint
    row.metadata_json = json.dumps(meta)
    db.commit()
    return {"valid": True}
