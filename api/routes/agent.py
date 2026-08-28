"""Application Agent v1 endpoints."""

import hmac
import json
import os
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from api.database import (
    AnswerLibraryEntry,
    ApplicationAgent,
    ApplicationAnswer,
    ApplicationApproval,
    CareerApplication,
    CareerJob,
    HistoryRecord,
    RecommendationBatch,
    RecommendationBatchItem,
    SubmissionCallbackEvent,
    SubmissionReceipt,
    User,
    get_db,
)
from api.dependencies import get_agent_user
from api.limits import enforce_external_api_limit
from api.schemas.agent import (
    AgentState,
    AgentTransitionRequest,
    AnswerLibraryCreate,
    AnswerLibraryUpdate,
    ApplicationAnswerUpsert,
    ApprovalCreate,
    ApprovalDecision,
    ApprovalDecisionRequest,
    ErrorCode,
    MaterialGenerationRequest,
    RecommendationBatchCreate,
    SubmissionCallback,
    SubmissionCreate,
    SubmissionStatus,
)
from api.workflows.application_agent import (
    agent_dict,
    application_and_history,
    answer_dict,
    approval_dict,
    canonical_json,
    content_digest,
    current_approved_snapshot,
    digest,
    domain_error,
    ensure_agent,
    get_agent,
    receipt_dict,
    record_agent_event,
    transition_agent,
)
from api.workflows.job_search import ensure_application_for_job, generate_application_materials


router = APIRouter(tags=["application-agent"])


def _model_dump(value) -> dict:
    return value.model_dump(mode="json") if hasattr(value, "model_dump") else value.dict()


def _idempotency_key(value: str | None) -> str:
    key = (value or "").strip()
    if not key:
        raise domain_error(400, ErrorCode.IDEMPOTENCY_REQUIRED,
                           "Idempotency-Key is required for this operation.")
    if len(key) > 128:
        raise domain_error(400, ErrorCode.VALIDATION_FAILED,
                           "Idempotency-Key must not exceed 128 characters.")
    return key


def _set_agent_state(agent: ApplicationAgent, state: AgentState) -> None:
    agent.state = state.value
    agent.version += 1
    agent.updated_at = datetime.utcnow()


def _agent_response(db: Session, agent: ApplicationAgent) -> dict:
    """Expose the v1 envelope plus flat fields for the existing control client."""
    payload = agent_dict(db, agent)
    return {**payload, "agent": payload}


def _batch_dict(db: Session, row: RecommendationBatch) -> dict:
    items = db.query(RecommendationBatchItem, CareerJob, CareerApplication, ApplicationAgent).join(
        CareerJob, RecommendationBatchItem.job_id == CareerJob.id,
    ).join(
        CareerApplication, RecommendationBatchItem.application_id == CareerApplication.id,
    ).join(
        ApplicationAgent, ApplicationAgent.application_id == CareerApplication.id,
    ).filter(RecommendationBatchItem.batch_id == row.id).order_by(
        RecommendationBatchItem.position,
    ).all()
    return {
        "id": row.public_id, "label": row.label, "status": row.status,
        "items": [{
            "id": item.public_id, "position": item.position,
            "job": {"id": job.public_id, "title": job.title, "company": job.company,
                    "location": job.location, "source": job.source, "source_url": job.source_url},
            "application_id": application.public_id, "agent_id": agent.public_id,
            "agent_state": agent.state,
        } for item, job, application, agent in items],
        "created_at": row.created_at.isoformat(), "updated_at": row.updated_at.isoformat(),
    }


@router.post("/api/agent/recommendation-batches", status_code=201)
def create_recommendation_batch(
    data: RecommendationBatchCreate,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    current_user: User = Depends(get_agent_user),
    db: Session = Depends(get_db),
):
    key = _idempotency_key(idempotency_key)
    payload = _model_dump(data)
    request_hash = digest(payload)
    existing = db.query(RecommendationBatch).filter(
        RecommendationBatch.user_id == current_user.id,
        RecommendationBatch.idempotency_key == key,
    ).first()
    if existing:
        if existing.request_hash != request_hash:
            raise domain_error(409, ErrorCode.IDEMPOTENCY_CONFLICT,
                               "Idempotency-Key was already used for a different request.")
        return _batch_dict(db, existing)

    if len(set(data.job_ids)) != len(data.job_ids):
        raise domain_error(422, ErrorCode.VALIDATION_FAILED,
                           "Recommendation batch job_ids must be unique.")
    jobs = db.query(CareerJob).filter(
        CareerJob.user_id == current_user.id,
        CareerJob.public_id.in_(data.job_ids),
    ).all()
    by_public_id = {job.public_id: job for job in jobs}
    missing = [job_id for job_id in data.job_ids if job_id not in by_public_id]
    if missing:
        raise domain_error(404, ErrorCode.NOT_FOUND, "One or more jobs were not found.",
                           context={"job_ids": missing})

    batch = RecommendationBatch(
        public_id=str(uuid4()), user_id=current_user.id, idempotency_key=key,
        request_hash=request_hash, label=data.label.strip(), status="ready",
    )
    db.add(batch)
    db.flush()
    for position, job_id in enumerate(data.job_ids):
        application = ensure_application_for_job(db, current_user, by_public_id[job_id])
        agent = ensure_agent(db, application)
        db.add(RecommendationBatchItem(
            public_id=str(uuid4()), batch_id=batch.id, user_id=current_user.id,
            job_id=by_public_id[job_id].id, application_id=application.id, position=position,
        ))
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        existing = db.query(RecommendationBatch).filter(
            RecommendationBatch.user_id == current_user.id,
            RecommendationBatch.idempotency_key == key,
        ).first()
        if existing and existing.request_hash == request_hash:
            return _batch_dict(db, existing)
        raise domain_error(409, ErrorCode.IDEMPOTENCY_CONFLICT,
                           "Recommendation batch creation conflicted with another request.",
                           retryable=existing is None) from exc
    db.refresh(batch)
    return _batch_dict(db, batch)


@router.get("/api/agent/recommendation-batches/latest")
def get_latest_recommendation_batch(current_user: User = Depends(get_agent_user),
                                    db: Session = Depends(get_db)):
    row = db.query(RecommendationBatch).filter(
        RecommendationBatch.user_id == current_user.id,
        RecommendationBatch.status == "ready",
    ).order_by(RecommendationBatch.id.desc()).first()
    if not row:
        raise domain_error(404, ErrorCode.NOT_FOUND, "No ready recommendation batch was found.")
    return _batch_dict(db, row)


@router.get("/api/agent/recommendation-batches/{public_id}")
def get_recommendation_batch(public_id: str, current_user: User = Depends(get_agent_user),
                             db: Session = Depends(get_db)):
    row = db.query(RecommendationBatch).filter(
        RecommendationBatch.user_id == current_user.id,
        RecommendationBatch.public_id == public_id,
    ).first()
    if not row:
        raise domain_error(404, ErrorCode.NOT_FOUND, "Recommendation batch not found.")
    return _batch_dict(db, row)


@router.get("/api/agent/applications/{public_id}")
def get_application_agent(public_id: str, current_user: User = Depends(get_agent_user),
                          db: Session = Depends(get_db)):
    return _agent_response(db, get_agent(db, current_user.id, public_id))


@router.post("/api/agent/applications/{public_id}/transitions")
def transition_application_agent(public_id: str, data: AgentTransitionRequest,
                                 current_user: User = Depends(get_agent_user),
    db: Session = Depends(get_db)):
    agent = get_agent(db, current_user.id, public_id)
    agent = transition_agent(
        db, agent, data.action, data.expected_version,
        commit=data.action.value != "request_approval",
    )
    if data.action.value == "request_approval":
        db.query(ApplicationApproval).filter(
            ApplicationApproval.agent_id == agent.id,
            ApplicationApproval.status == "pending",
        ).update({ApplicationApproval.status: "superseded",
                  ApplicationApproval.updated_at: datetime.utcnow()}, synchronize_session=False)
        db.add(ApplicationApproval(
            public_id=str(uuid4()), agent_id=agent.id, user_id=current_user.id,
            status="pending", content_digest=content_digest(db, agent),
            requested_note=data.reason.strip(),
        ))
        db.commit()
        db.refresh(agent)
    return _agent_response(db, agent)


@router.post("/api/agent/applications/{public_id}/materials")
def prepare_application_materials(
    public_id: str,
    data: MaterialGenerationRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    current_user: User = Depends(get_agent_user),
    db: Session = Depends(get_db),
):
    key = _idempotency_key(idempotency_key)
    request_hash = digest(_model_dump(data))
    agent = get_agent(db, current_user.id, public_id)
    application, history = application_and_history(db, agent)
    if agent.material_idempotency_key == key and agent.material_request_hash != request_hash:
        raise domain_error(409, ErrorCode.IDEMPOTENCY_CONFLICT,
                           "Idempotency-Key was already used for different material settings.")
    if history.resume_tex:
        return _agent_response(db, agent)
    if agent.state not in {AgentState.PREPARING.value, AgentState.NEEDS_ATTENTION.value}:
        raise domain_error(409, ErrorCode.INVALID_STATE_TRANSITION,
                           "Materials may only be prepared for an active preparation run.")
    enforce_external_api_limit(db, current_user, units=3, check_burst=True)
    try:
        generate_application_materials(
            db, current_user, application,
            target_ats_score=data.target_ats_score,
            max_optimization_rounds=data.max_optimization_rounds,
            template=data.template,
        )
    except Exception as exc:
        agent = get_agent(db, current_user.id, public_id)
        previous_state = agent.state
        _set_agent_state(agent, AgentState.NEEDS_ATTENTION)
        record_agent_event(db, agent, "safety", "Material generation needs attention",
                           from_state=previous_state, to_state=agent.state)
        agent.last_error_code = ErrorCode.MATERIAL_GENERATION_FAILED.value
        agent.last_error_message = "Material generation failed; review server logs and retry."
        db.commit()
        raise domain_error(502, ErrorCode.MATERIAL_GENERATION_FAILED,
                           "Material generation failed.", retryable=True,
                           context={"type": type(exc).__name__}) from exc
    agent = get_agent(db, current_user.id, public_id)
    agent.material_idempotency_key = key
    agent.material_request_hash = request_hash
    agent.last_error_code = agent.last_error_message = None
    record_agent_event(db, agent, "material", "Resume materials generated",
                       detail=f"ATS score: {agent_dict(db, agent).get('ats_score')}")
    db.commit()
    return _agent_response(db, agent)


@router.get("/api/agent/answers")
def list_answer_library(current_user: User = Depends(get_agent_user), db: Session = Depends(get_db)):
    rows = db.query(AnswerLibraryEntry).filter(
        AnswerLibraryEntry.user_id == current_user.id,
    ).order_by(AnswerLibraryEntry.updated_at.desc()).all()
    return {"answers": [answer_dict(row) for row in rows]}


@router.post("/api/agent/answers", status_code=201)
def create_answer_library(data: AnswerLibraryCreate, current_user: User = Depends(get_agent_user),
                          db: Session = Depends(get_db)):
    existing = db.query(AnswerLibraryEntry).filter(
        AnswerLibraryEntry.user_id == current_user.id,
        AnswerLibraryEntry.question_key == data.question_key,
    ).first()
    if existing:
        raise domain_error(409, ErrorCode.VALIDATION_FAILED,
                           "An answer with this question_key already exists.")
    row = AnswerLibraryEntry(
        public_id=str(uuid4()), user_id=current_user.id, **_model_dump(data),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"answer": answer_dict(row)}


@router.patch("/api/agent/answers/{public_id}")
def update_answer_library(public_id: str, data: AnswerLibraryUpdate,
                          current_user: User = Depends(get_agent_user),
                          db: Session = Depends(get_db)):
    row = db.query(AnswerLibraryEntry).filter(
        AnswerLibraryEntry.user_id == current_user.id,
        AnswerLibraryEntry.public_id == public_id,
    ).first()
    if not row:
        raise domain_error(404, ErrorCode.NOT_FOUND, "Answer library entry not found.")
    values = data.model_dump(exclude_unset=True) if hasattr(data, "model_dump") else data.dict(exclude_unset=True)
    for name, value in values.items():
        setattr(row, name, value)
    row.version += 1
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return {"answer": answer_dict(row)}


@router.put("/api/agent/applications/{public_id}/answers/{question_key}")
def upsert_application_answer(public_id: str, question_key: str, data: ApplicationAnswerUpsert,
                              current_user: User = Depends(get_agent_user),
                              db: Session = Depends(get_db)):
    if question_key != data.question_key:
        raise domain_error(422, ErrorCode.VALIDATION_FAILED,
                           "Path and body question_key values must match.")
    agent = get_agent(db, current_user.id, public_id)
    if AgentState(agent.state) in {AgentState.SUBMITTING, AgentState.SUBMITTED, AgentState.WITHDRAWN}:
        raise domain_error(409, ErrorCode.INVALID_STATE_TRANSITION,
                           "Answers cannot be changed in the current state.")
    row = db.query(ApplicationAnswer).filter(
        ApplicationAnswer.agent_id == agent.id,
        ApplicationAnswer.question_key == question_key,
    ).first()
    if not row:
        row = ApplicationAnswer(public_id=str(uuid4()), agent_id=agent.id,
                                user_id=current_user.id, question_key=question_key)
        db.add(row)
    row.question = data.question
    row.answer = data.answer
    row.required = data.required
    row.source = "user"
    row.updated_at = datetime.utcnow()
    if data.save_to_library:
        library = db.query(AnswerLibraryEntry).filter(
            AnswerLibraryEntry.user_id == current_user.id,
            AnswerLibraryEntry.question_key == question_key,
        ).first()
        if not library:
            library = AnswerLibraryEntry(public_id=str(uuid4()), user_id=current_user.id,
                                         question_key=question_key)
            db.add(library)
        library.question, library.answer = data.question, data.answer
        library.reusable, library.updated_at = True, datetime.utcnow()
        if library.id:
            library.version += 1
    if agent.state == AgentState.APPROVED.value:
        previous_state = agent.state
        _set_agent_state(agent, AgentState.AWAITING_APPROVAL)
        record_agent_event(db, agent, "answer", "Application answer updated; approval expired",
                           detail=question_key, from_state=previous_state, to_state=agent.state)
    else:
        record_agent_event(db, agent, "answer", "Application answer updated", detail=question_key)
    db.commit()
    db.refresh(row)
    return {**_agent_response(db, agent), "answer": answer_dict(row)}


@router.post("/api/agent/applications/{public_id}/approvals", status_code=201)
def create_approval(public_id: str, data: ApprovalCreate,
                    current_user: User = Depends(get_agent_user), db: Session = Depends(get_db)):
    agent = get_agent(db, current_user.id, public_id)
    if agent.state != AgentState.AWAITING_APPROVAL.value:
        raise domain_error(409, ErrorCode.INVALID_STATE_TRANSITION,
                           "Approval may only be requested from awaiting_approval.")
    db.query(ApplicationApproval).filter(
        ApplicationApproval.agent_id == agent.id,
        ApplicationApproval.status == "pending",
    ).update({ApplicationApproval.status: "superseded",
              ApplicationApproval.updated_at: datetime.utcnow()}, synchronize_session=False)
    row = ApplicationApproval(
        public_id=str(uuid4()), agent_id=agent.id, user_id=current_user.id,
        status="pending", content_digest=content_digest(db, agent),
        requested_note=data.note.strip(),
    )
    db.add(row)
    record_agent_event(db, agent, "approval", "Approval requested")
    db.commit()
    db.refresh(row)
    return {"approval": approval_dict(row)}


@router.post("/api/agent/approvals/{public_id}/decision")
def decide_approval(public_id: str, data: ApprovalDecisionRequest,
                    current_user: User = Depends(get_agent_user), db: Session = Depends(get_db)):
    row = db.query(ApplicationApproval).filter(
        ApplicationApproval.user_id == current_user.id,
        ApplicationApproval.public_id == public_id,
    ).first()
    if not row:
        raise domain_error(404, ErrorCode.NOT_FOUND, "Approval not found.")
    agent = db.query(ApplicationAgent).filter(ApplicationAgent.id == row.agent_id).first()
    if row.status != "pending" or agent.version != data.expected_version or agent.state != AgentState.AWAITING_APPROVAL.value:
        raise domain_error(409, ErrorCode.INVALID_STATE_TRANSITION,
                           "Approval is stale or no longer pending.", retryable=True)
    if data.decision == ApprovalDecision.APPROVED and row.content_digest != content_digest(db, agent):
        raise domain_error(409, ErrorCode.APPROVAL_STALE,
                           "Application content changed after approval was requested.")
    row.status = data.decision.value
    row.version += 1
    row.decision_note = data.note.strip()
    row.decided_at = row.updated_at = datetime.utcnow()
    previous_state = agent.state
    _set_agent_state(agent, AgentState.APPROVED if data.decision == ApprovalDecision.APPROVED else AgentState.REJECTED)
    record_agent_event(
        db, agent, "approval", f"Approval {data.decision.value}",
        detail=data.note.strip(), from_state=previous_state, to_state=agent.state,
    )
    application = db.query(CareerApplication).filter(CareerApplication.id == agent.application_id).first()
    application.approval_status = data.decision.value
    application.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return {**_agent_response(db, agent), "approval": approval_dict(row)}


@router.post("/api/agent/applications/{public_id}/submissions", status_code=202)
def create_submission(
    public_id: str,
    data: SubmissionCreate,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    current_user: User = Depends(get_agent_user),
    db: Session = Depends(get_db),
):
    key = _idempotency_key(idempotency_key)
    agent = get_agent(db, current_user.id, public_id)
    request_hash = digest({"agent_id": public_id, **_model_dump(data)})
    existing = db.query(SubmissionReceipt).filter(
        SubmissionReceipt.user_id == current_user.id,
        SubmissionReceipt.idempotency_key == key,
    ).first()
    if existing:
        if existing.request_hash != request_hash:
            raise domain_error(409, ErrorCode.IDEMPOTENCY_CONFLICT,
                               "Idempotency-Key was already used for a different request.")
        return {**_agent_response(db, agent), "receipt": receipt_dict(existing)}
    if agent.state != AgentState.APPROVED.value:
        raise domain_error(409, ErrorCode.APPROVAL_REQUIRED,
                           "Application Agent must be approved before submission.")
    approval = current_approved_snapshot(db, agent)
    try:
        enforce_external_api_limit(db, current_user, units=1, check_burst=True, commit=False)
    except HTTPException as exc:
        raise domain_error(429, ErrorCode.SUBMISSION_LIMIT_REACHED,
                           "External submission limit reached.", retryable=True) from exc
    receipt = SubmissionReceipt(
        public_id=str(uuid4()), agent_id=agent.id, application_id=agent.application_id,
        approval_id=approval.id, user_id=current_user.id, idempotency_key=key,
        request_hash=request_hash, provider=data.provider, status=SubmissionStatus.QUEUED.value,
    )
    db.add(receipt)
    previous_state = agent.state
    _set_agent_state(agent, AgentState.SUBMITTING)
    record_agent_event(db, agent, "submission", "Submission queued",
                       detail=data.provider, from_state=previous_state, to_state=agent.state)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        existing = db.query(SubmissionReceipt).filter(
            SubmissionReceipt.user_id == current_user.id,
            SubmissionReceipt.idempotency_key == key,
        ).first()
        if existing and existing.request_hash == request_hash:
            agent = get_agent(db, current_user.id, public_id)
            return {**_agent_response(db, agent), "receipt": receipt_dict(existing)}
        raise domain_error(409, ErrorCode.IDEMPOTENCY_CONFLICT,
                           "Submission creation conflicted with another request.",
                           retryable=existing is None) from exc
    db.refresh(receipt)
    return {**_agent_response(db, agent), "receipt": receipt_dict(receipt)}


def _contains_secret(value) -> bool:
    forbidden = ("token", "secret", "password", "credential", "authorization", "cookie")
    if isinstance(value, dict):
        return any(any(part in str(key).lower() for part in forbidden) or _contains_secret(item)
                   for key, item in value.items())
    if isinstance(value, list):
        return any(_contains_secret(item) for item in value)
    return False


@router.post("/api/internal/agent/submission-callbacks")
def submission_callback(data: SubmissionCallback,
                        callback_secret: str | None = Header(default=None, alias="X-Internal-Callback-Secret"),
                        db: Session = Depends(get_db)):
    configured = os.environ.get("AGENT_CALLBACK_SECRET", "").strip()
    if not configured or not callback_secret or not hmac.compare_digest(configured, callback_secret):
        raise domain_error(401, ErrorCode.CALLBACK_UNAUTHORIZED, "Invalid callback credentials.")
    if _contains_secret(data.metadata):
        raise domain_error(400, ErrorCode.VALIDATION_FAILED,
                           "Callback metadata must not contain credentials or secrets.")
    payload = _model_dump(data)
    payload_hash = digest(payload)
    replay = db.query(SubmissionCallbackEvent).filter(
        SubmissionCallbackEvent.event_id == data.event_id,
    ).first()
    if replay:
        if replay.payload_hash != payload_hash:
            raise domain_error(409, ErrorCode.CALLBACK_CONFLICT,
                               "Callback event_id was replayed with different content.")
        receipt = db.query(SubmissionReceipt).filter(SubmissionReceipt.id == replay.receipt_id).first()
        return {"receipt": receipt_dict(receipt), "replayed": True}
    receipt = db.query(SubmissionReceipt).filter(SubmissionReceipt.public_id == data.receipt_id).first()
    if not receipt:
        raise domain_error(404, ErrorCode.NOT_FOUND, "Submission receipt not found.")
    agent = db.query(ApplicationAgent).filter(ApplicationAgent.id == receipt.agent_id).first()
    db.add(SubmissionCallbackEvent(
        event_id=data.event_id, receipt_id=receipt.id, payload_hash=payload_hash,
        payload_json=canonical_json(payload),
    ))
    current_status = SubmissionStatus(receipt.status)
    if current_status not in {SubmissionStatus.SUCCEEDED, SubmissionStatus.FAILED}:
        receipt.status = data.status.value
        receipt.external_application_id = data.external_application_id
        receipt.error_code = data.error_code
        receipt.error_message = data.error_message
        receipt.metadata_json = canonical_json(data.metadata)
        receipt.updated_at = datetime.utcnow()
        if data.status == SubmissionStatus.SUCCEEDED:
            receipt.completed_at = datetime.utcnow()
            previous_state = agent.state
            _set_agent_state(agent, AgentState.SUBMITTED)
            record_agent_event(db, agent, "submission", "External submission verified",
                               detail=data.external_application_id or "",
                               from_state=previous_state, to_state=agent.state)
            application = db.query(CareerApplication).filter(CareerApplication.id == receipt.application_id).first()
            application.status = "applied"
            application.updated_at = datetime.utcnow()
            history = db.query(HistoryRecord).filter(
                HistoryRecord.id == application.history_record_id,
                HistoryRecord.user_id == application.user_id,
            ).first()
            if history:
                history.status = "applied"
        elif data.status == SubmissionStatus.FAILED:
            receipt.completed_at = datetime.utcnow()
            previous_state = agent.state
            _set_agent_state(agent, AgentState.NEEDS_ATTENTION)
            record_agent_event(db, agent, "safety", "External submission needs attention",
                               detail=data.error_code or "submission_failed",
                               from_state=previous_state, to_state=agent.state)
            agent.last_error_code = data.error_code or "submission_failed"
            agent.last_error_message = data.error_message or "External submission failed."
    db.commit()
    db.refresh(receipt)
    return {"receipt": receipt_dict(receipt), "replayed": False}
