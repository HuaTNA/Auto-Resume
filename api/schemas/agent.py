"""Versioned public contract for the Application Agent platform.

Keep values in this module backward compatible. Database and workflow code may
import these enums, but transport-only models must not import ORM models.
"""

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class AgentState(str, Enum):
    DISCOVERED = "discovered"
    PREPARING = "preparing"
    AWAITING_ANSWERS = "awaiting_answers"
    AWAITING_APPROVAL = "awaiting_approval"
    APPROVED = "approved"
    SUBMITTING = "submitting"
    SUBMITTED = "submitted"
    NEEDS_ATTENTION = "needs_attention"
    REJECTED = "rejected"
    FAILED = "failed"
    WITHDRAWN = "withdrawn"


class AgentAction(str, Enum):
    START = "start"
    REQUEST_ANSWERS = "request_answers"
    REQUEST_APPROVAL = "request_approval"
    RETRY = "retry"
    WITHDRAW = "withdraw"


class ApprovalDecision(str, Enum):
    APPROVED = "approved"
    REJECTED = "rejected"


class SubmissionStatus(str, Enum):
    QUEUED = "queued"
    ACCEPTED = "accepted"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class MaterialStatus(str, Enum):
    COMPLETED = "completed"
    DEGRADED = "degraded"
    FAILED = "failed"


class BlockerKind(str, Enum):
    CAPTCHA = "captcha"
    TWO_FACTOR = "two_factor"
    AUTH_EXPIRED = "auth_expired"
    SENSITIVE_QUESTION = "sensitive_question"
    PAGE_STRUCTURE = "page_structure"
    SUBMISSION_UNVERIFIED = "submission_unverified"
    UNSUPPORTED_SITE = "unsupported_site"


class ErrorCode(str, Enum):
    NOT_FOUND = "agent.not_found"
    IDEMPOTENCY_REQUIRED = "agent.idempotency_required"
    IDEMPOTENCY_CONFLICT = "agent.idempotency_conflict"
    INVALID_STATE_TRANSITION = "agent.invalid_state_transition"
    ANSWERS_INCOMPLETE = "agent.answers_incomplete"
    MATERIALS_REQUIRED = "agent.materials_required"
    MATERIAL_GENERATION_FAILED = "agent.material_generation_failed"
    MATERIAL_BUDGET_EXCEEDED = "agent.material_budget_exceeded"
    APPROVAL_REQUIRED = "agent.approval_required"
    APPROVAL_STALE = "agent.approval_stale"
    SUBMISSION_LIMIT_REACHED = "agent.submission_limit_reached"
    CALLBACK_UNAUTHORIZED = "agent.callback_unauthorized"
    CALLBACK_CONFLICT = "agent.callback_conflict"
    DISPATCH_UNAVAILABLE = "agent.dispatch_unavailable"
    HUMAN_INTERVENTION_REQUIRED = "agent.human_intervention_required"
    SUBMISSION_UNVERIFIED = "agent.submission_unverified"
    VALIDATION_FAILED = "agent.validation_failed"


class ErrorDetail(BaseModel):
    code: ErrorCode
    message: str
    retryable: bool = False
    context: dict[str, Any] = Field(default_factory=dict)


class RecommendationBatchCreate(BaseModel):
    job_ids: list[str] = Field(min_length=1, max_length=50)
    label: str = Field(default="", max_length=255)


class AgentSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=255)
    location: str = Field(default="Toronto", min_length=1, max_length=255)
    max_results: int = Field(default=15, ge=1, le=30)


class RecommendationSelectionCallback(BaseModel):
    event_id: str = Field(min_length=1, max_length=128)
    batch_id: str = Field(min_length=1, max_length=64)
    selected_job_ids: list[str] = Field(min_length=1, max_length=50)
    source: str = Field(default="discord", max_length=32)
    external_actor_ref: str | None = Field(default=None, max_length=255)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AgentTransitionRequest(BaseModel):
    action: AgentAction
    expected_version: int = Field(ge=1)
    reason: str = Field(default="", max_length=2000)


class AnswerLibraryCreate(BaseModel):
    question_key: str = Field(min_length=1, max_length=128, pattern=r"^[a-z0-9][a-z0-9._-]*$")
    question: str = Field(min_length=1, max_length=1000)
    answer: str = Field(min_length=1, max_length=20000)
    category: str = Field(default="general", max_length=64)
    reusable: bool = True


class AnswerLibraryUpdate(BaseModel):
    question: str | None = Field(default=None, min_length=1, max_length=1000)
    answer: str | None = Field(default=None, min_length=1, max_length=20000)
    category: str | None = Field(default=None, max_length=64)
    reusable: bool | None = None


class ApplicationAnswerUpsert(BaseModel):
    question_key: str = Field(min_length=1, max_length=128, pattern=r"^[a-z0-9][a-z0-9._-]*$")
    question: str = Field(min_length=1, max_length=1000)
    answer: str = Field(min_length=1, max_length=20000)
    required: bool = True
    save_to_library: bool = False


class ApprovalCreate(BaseModel):
    note: str = Field(default="", max_length=2000)


class ApprovalDecisionRequest(BaseModel):
    decision: ApprovalDecision
    expected_version: int = Field(ge=1)
    note: str = Field(default="", max_length=2000)


class MaterialGenerationRequest(BaseModel):
    target_ats_score: int = Field(default=85, ge=0, le=100)
    max_optimization_rounds: int = Field(default=2, ge=0, le=2)
    template: str = Field(default="classic", min_length=1, max_length=100)
    generate_cover_letter: bool = True


class JobMatchScore(BaseModel):
    score: float | None = Field(default=None, ge=0, le=100)
    reason: str = Field(default="", max_length=4000)
    source: Literal["job_finder"] = "job_finder"


class ResumeAtsScore(BaseModel):
    overall_score: float | None = Field(default=None, ge=0, le=100)
    keyword_match_score: float | None = Field(default=None, ge=0, le=100)
    relevance_score: float | None = Field(default=None, ge=0, le=100)
    impact_score: float | None = Field(default=None, ge=0, le=100)


class MaterialArtifact(BaseModel):
    resume_tex: str | None = None
    cover_letter: str | None = None
    selected_version: int | None = Field(default=None, ge=1)


class MaterialPipelineError(BaseModel):
    stage: str = Field(min_length=1, max_length=64)
    type: str = Field(min_length=1, max_length=128)
    message: str = Field(min_length=1, max_length=2000)
    round: int | None = Field(default=None, ge=0, le=2)


class MaterialResultCallback(BaseModel):
    event_id: str = Field(min_length=1, max_length=128)
    application_id: str = Field(min_length=1, max_length=64)
    status: MaterialStatus
    job_match: JobMatchScore
    resume_ats: ResumeAtsScore | None = None
    material: MaterialArtifact
    versions: list[dict[str, Any]] = Field(default_factory=list, max_length=3)
    optimization_rounds: int = Field(default=0, ge=0, le=2)
    warnings: list[str] = Field(default_factory=list, max_length=50)
    errors: list[MaterialPipelineError] = Field(default_factory=list, max_length=20)


class SubmissionCreate(BaseModel):
    provider: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9._-]*$")
    approval_id: str | None = Field(default=None, max_length=64)
    expected_version: int | None = Field(default=None, ge=1)


class SubmissionDispatch(BaseModel):
    receipt_id: str = Field(min_length=1, max_length=64)
    approval_id: str = Field(min_length=1, max_length=64)
    application_id: str = Field(min_length=1, max_length=64)
    job_url: str = Field(min_length=1, max_length=4000)
    provider: str = Field(min_length=1, max_length=64)
    content_digest: str = Field(min_length=64, max_length=64)
    fields: dict[str, str | bool] = Field(default_factory=dict)
    sensitive_field_keys: list[str] = Field(default_factory=list)
    resume_download_url: str
    cover_letter_download_url: str | None = None
    expires_at: str


class SubmissionCallback(BaseModel):
    event_id: str = Field(min_length=1, max_length=128)
    receipt_id: str = Field(min_length=1, max_length=64)
    status: SubmissionStatus
    external_application_id: str | None = Field(default=None, max_length=255)
    error_code: str | None = Field(default=None, max_length=128)
    error_message: str | None = Field(default=None, max_length=2000)
    metadata: dict[str, Any] = Field(default_factory=dict)


class SubmissionBlockerCallback(BaseModel):
    event_id: str = Field(min_length=1, max_length=128)
    receipt_id: str = Field(min_length=1, max_length=64)
    blocker: BlockerKind
    message: str = Field(min_length=1, max_length=2000)
    page_url: str | None = Field(default=None, max_length=4000)
    metadata: dict[str, Any] = Field(default_factory=dict)
