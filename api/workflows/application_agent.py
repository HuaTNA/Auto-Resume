"""Application Agent state machine and safety-critical persistence helpers."""

import hashlib
import json
from datetime import datetime
from typing import Any
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy.orm import Session

from api.database import (
    AnswerLibraryEntry,
    ApplicationAgent,
    ApplicationAgentEvent,
    ApplicationAnswer,
    ApplicationApproval,
    CareerApplication,
    Document,
    DocumentVersion,
    HistoryRecord,
    SubmissionReceipt,
)
from api.schemas.agent import AgentAction, AgentState, ErrorCode


TRANSITIONS: dict[AgentAction, dict[AgentState, AgentState]] = {
    AgentAction.START: {AgentState.DISCOVERED: AgentState.PREPARING},
    AgentAction.REQUEST_ANSWERS: {AgentState.PREPARING: AgentState.AWAITING_ANSWERS},
    AgentAction.REQUEST_APPROVAL: {
        AgentState.PREPARING: AgentState.AWAITING_APPROVAL,
        AgentState.AWAITING_ANSWERS: AgentState.AWAITING_APPROVAL,
        AgentState.NEEDS_ATTENTION: AgentState.AWAITING_APPROVAL,
    },
    AgentAction.RETRY: {
        AgentState.FAILED: AgentState.PREPARING,
        AgentState.NEEDS_ATTENTION: AgentState.PREPARING,
    },
}

TERMINAL_STATES = {
    AgentState.SUBMITTED, AgentState.REJECTED, AgentState.FAILED, AgentState.WITHDRAWN,
}


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def domain_error(status: int, code: ErrorCode, message: str, *, retryable: bool = False,
                 context: dict[str, Any] | None = None) -> HTTPException:
    return HTTPException(status_code=status, detail={
        "code": code.value, "message": message, "retryable": retryable,
        "context": context or {},
    })


def ensure_agent(db: Session, application: CareerApplication) -> ApplicationAgent:
    agent = db.query(ApplicationAgent).filter(
        ApplicationAgent.application_id == application.id,
    ).first()
    if agent:
        return agent
    agent = ApplicationAgent(
        public_id=str(uuid4()), user_id=application.user_id,
        application_id=application.id, state=AgentState.DISCOVERED.value,
    )
    db.add(agent)
    db.flush()
    record_agent_event(db, agent, "state", "Application Agent created",
                       from_state=None, to_state=AgentState.DISCOVERED.value)
    return agent


def record_agent_event(db: Session, agent: ApplicationAgent, kind: str, title: str,
                       detail: str = "", *, from_state: str | None = None,
                       to_state: str | None = None) -> ApplicationAgentEvent:
    event = ApplicationAgentEvent(
        public_id=str(uuid4()), agent_id=agent.id, user_id=agent.user_id,
        kind=kind[:32], title=title[:255], detail=detail[:4000],
        from_state=from_state, to_state=to_state,
    )
    db.add(event)
    return event


def get_agent(db: Session, user_id: int, public_id: str) -> ApplicationAgent:
    agent = db.query(ApplicationAgent).filter(
        ApplicationAgent.user_id == user_id,
        ApplicationAgent.public_id == public_id,
    ).first()
    if not agent:
        application = db.query(CareerApplication).filter(
            CareerApplication.user_id == user_id,
            CareerApplication.public_id == public_id,
        ).first()
        if application:
            agent = ensure_agent(db, application)
            db.commit()
            db.refresh(agent)
    if not agent:
        raise domain_error(404, ErrorCode.NOT_FOUND, "Application Agent not found.")
    return agent


def transition_agent(db: Session, agent: ApplicationAgent, action: AgentAction,
                     expected_version: int, *, commit: bool = True) -> ApplicationAgent:
    current = AgentState(agent.state)
    if agent.version != expected_version:
        raise domain_error(409, ErrorCode.INVALID_STATE_TRANSITION,
                           "Application Agent version is stale.", retryable=True,
                           context={"current_version": agent.version, "current_state": agent.state})
    if action == AgentAction.WITHDRAW:
        if current in TERMINAL_STATES or current == AgentState.SUBMITTING:
            next_state = None
        else:
            next_state = AgentState.WITHDRAWN
    else:
        next_state = TRANSITIONS.get(action, {}).get(current)
    if next_state is None:
        raise domain_error(409, ErrorCode.INVALID_STATE_TRANSITION,
                           f"Action '{action.value}' is not allowed from '{current.value}'.",
                           context={"state": current.value, "action": action.value})
    if action == AgentAction.REQUEST_APPROVAL:
        assert_ready_for_approval(db, agent)
    updated = db.query(ApplicationAgent).filter(
        ApplicationAgent.id == agent.id,
        ApplicationAgent.version == expected_version,
    ).update({
        ApplicationAgent.state: next_state.value,
        ApplicationAgent.version: expected_version + 1,
        ApplicationAgent.updated_at: datetime.utcnow(),
        ApplicationAgent.last_error_code: None,
        ApplicationAgent.last_error_message: None,
    }, synchronize_session=False)
    if updated != 1:
        db.rollback()
        raise domain_error(409, ErrorCode.INVALID_STATE_TRANSITION,
                           "Application Agent was changed by another request.", retryable=True)
    record_agent_event(
        db, agent, "state", f"Agent state changed to {next_state.value}",
        from_state=current.value, to_state=next_state.value,
    )
    if commit:
        db.commit()
    else:
        db.flush()
        db.expire_all()
    return get_agent(db, agent.user_id, agent.public_id)


def application_and_history(db: Session, agent: ApplicationAgent) -> tuple[CareerApplication, HistoryRecord]:
    application = db.query(CareerApplication).filter(
        CareerApplication.id == agent.application_id,
        CareerApplication.user_id == agent.user_id,
    ).first()
    history = db.query(HistoryRecord).filter(
        HistoryRecord.id == application.history_record_id,
        HistoryRecord.user_id == agent.user_id,
    ).first() if application else None
    if not application or not history:
        raise domain_error(404, ErrorCode.NOT_FOUND, "Application record not found.")
    return application, history


def assert_ready_for_approval(db: Session, agent: ApplicationAgent) -> None:
    _, history = application_and_history(db, agent)
    if not history.resume_tex:
        raise domain_error(409, ErrorCode.MATERIALS_REQUIRED,
                           "Generated resume materials are required before approval.")
    incomplete = db.query(ApplicationAnswer).filter(
        ApplicationAnswer.agent_id == agent.id,
        ApplicationAnswer.required.is_(True),
        ApplicationAnswer.answer == "",
    ).count()
    if incomplete:
        raise domain_error(409, ErrorCode.ANSWERS_INCOMPLETE,
                           "All required application answers must be completed.")


def content_snapshot(db: Session, agent: ApplicationAgent) -> dict[str, Any]:
    _, history = application_and_history(db, agent)
    answers = db.query(ApplicationAnswer).filter(
        ApplicationAnswer.agent_id == agent.id,
    ).order_by(ApplicationAnswer.question_key).all()
    return {
        "resume_tex": history.resume_tex or "",
        "cover_letter": history.cover_letter or "",
        "answers": [{"key": row.question_key, "question": row.question, "answer": row.answer}
                    for row in answers],
    }


def content_digest(db: Session, agent: ApplicationAgent) -> str:
    return digest(content_snapshot(db, agent))


def latest_approval(db: Session, agent: ApplicationAgent) -> ApplicationApproval | None:
    return db.query(ApplicationApproval).filter(
        ApplicationApproval.agent_id == agent.id,
    ).order_by(ApplicationApproval.id.desc()).first()


def current_approved_snapshot(db: Session, agent: ApplicationAgent) -> ApplicationApproval:
    approval = db.query(ApplicationApproval).filter(
        ApplicationApproval.agent_id == agent.id,
        ApplicationApproval.status == "approved",
    ).order_by(ApplicationApproval.id.desc()).first()
    if not approval:
        raise domain_error(409, ErrorCode.APPROVAL_REQUIRED,
                           "A current human approval is required before submission.")
    if approval.content_digest != content_digest(db, agent):
        raise domain_error(409, ErrorCode.APPROVAL_STALE,
                           "Application content changed after approval; approve the new snapshot.")
    return approval


def answer_dict(row: ApplicationAnswer | AnswerLibraryEntry) -> dict[str, Any]:
    result = {
        "id": row.public_id, "question_key": row.question_key,
        "question": row.question, "answer": row.answer,
        "created_at": row.created_at.isoformat(), "updated_at": row.updated_at.isoformat(),
    }
    for key in ("category", "reusable", "required", "source", "version"):
        if hasattr(row, key):
            result[key] = getattr(row, key)
    return result


def approval_dict(row: ApplicationApproval | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "id": row.public_id, "status": row.status, "content_digest": row.content_digest,
        "version": row.version, "requested_note": row.requested_note,
        "decision_note": row.decision_note,
        "decided_at": row.decided_at.isoformat() if row.decided_at else None,
        "created_at": row.created_at.isoformat(), "updated_at": row.updated_at.isoformat(),
    }


def receipt_dict(row: SubmissionReceipt | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "id": row.public_id, "provider": row.provider, "status": row.status,
        "external_application_id": row.external_application_id,
        "error_code": row.error_code, "error_message": row.error_message,
        "metadata": json.loads(row.metadata_json or "{}"),
        "created_at": row.created_at.isoformat(), "updated_at": row.updated_at.isoformat(),
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
    }


def agent_dict(db: Session, row: ApplicationAgent) -> dict[str, Any]:
    application, history = application_and_history(db, row)
    answers = db.query(ApplicationAnswer).filter(
        ApplicationAnswer.agent_id == row.id,
    ).order_by(ApplicationAnswer.question_key).all()
    receipt = db.query(SubmissionReceipt).filter(
        SubmissionReceipt.agent_id == row.id,
    ).order_by(SubmissionReceipt.id.desc()).first()
    events = db.query(ApplicationAgentEvent).filter(
        ApplicationAgentEvent.agent_id == row.id,
        ApplicationAgentEvent.user_id == row.user_id,
    ).order_by(ApplicationAgentEvent.id).all()
    resume_document = db.query(Document).filter(
        Document.user_id == row.user_id,
        Document.source_record_id == history.id,
        Document.kind == "resume",
    ).first()
    resume_version = None
    pipeline_summary = None
    if resume_document:
        resume_version = db.query(DocumentVersion).filter(
            DocumentVersion.document_id == resume_document.id,
            DocumentVersion.user_id == row.user_id,
        ).order_by(DocumentVersion.version_number.desc()).first()
        if resume_version:
            metadata = json.loads(resume_version.metadata_json or "{}")
            pipeline_summary = metadata.get("material_pipeline")
    optimization = pipeline_summary.get("optimization", {}) if pipeline_summary else {}
    return {
        "id": row.public_id, "application_id": application.public_id,
        "state": row.state, "version": row.version,
        "match_score": application.match_score,
        "ats_score": json.loads(history.ats_scores or "{}").get("overall"),
        "ats_rounds": optimization.get("rounds", 0),
        "resume_version": (
            pipeline_summary.get("selected_version") if pipeline_summary
            else (resume_version.version_number if resume_version else None)
        ),
        "job": _job_dict(db, application),
        "last_error": ({"code": row.last_error_code, "message": row.last_error_message}
                       if row.last_error_code else None),
        "answers": [answer_dict(answer) for answer in answers],
        "latest_approval": approval_dict(latest_approval(db, row)),
        "latest_receipt": receipt_dict(receipt),
        "timeline": [{
            "id": event.public_id, "kind": event.kind,
            "title": event.title, "detail": event.detail or None,
            "from_state": event.from_state, "to_state": event.to_state,
            "created_at": event.created_at.isoformat(),
        } for event in events],
        "material_pipeline": pipeline_summary,
        "created_at": row.created_at.isoformat(), "updated_at": row.updated_at.isoformat(),
    }


def _job_dict(db: Session, application: CareerApplication) -> dict[str, Any]:
    from api.database import CareerJob
    job = db.query(CareerJob).filter(CareerJob.id == application.job_id).first()
    return {
        "id": job.public_id, "title": job.title, "company": job.company,
        "location": job.location, "provider": job.source,
        "source_url": job.source_url,
    } if job else {}
