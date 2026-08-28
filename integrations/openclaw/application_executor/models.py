from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from hashlib import sha256
import json
from typing import Any, Mapping


class ExecutionStatus(str, Enum):
    READY_FOR_APPROVAL = "ready_for_approval"
    SUBMITTED = "submitted"
    BLOCKED = "blocked"


class BlockerKind(str, Enum):
    APPROVAL_REQUIRED = "approval_required"
    CAPTCHA = "captcha"
    TWO_FACTOR = "two_factor"
    AUTH_EXPIRED = "auth_expired"
    SENSITIVE_QUESTION = "sensitive_question"
    BLOCKED_QUESTION = "blocked_question"
    PAGE_STRUCTURE = "page_structure"
    SUBMISSION_UNVERIFIED = "submission_unverified"
    UNSUPPORTED_SITE = "unsupported_site"
    DOMAIN_NOT_ALLOWED = "domain_not_allowed"
    DRY_RUN = "dry_run"


@dataclass(frozen=True)
class FieldValue:
    """One answer. ``sensitive`` is never inferred as safe by an adapter."""

    value: str | bool
    sensitive: bool = False


@dataclass(frozen=True)
class ApplicationData:
    fields: Mapping[str, FieldValue | str | bool] = field(default_factory=dict)
    resume_path: str | None = None
    cover_letter_path: str | None = None

    def normalized_fields(self) -> dict[str, FieldValue]:
        return {
            key: value if isinstance(value, FieldValue) else FieldValue(value)
            for key, value in self.fields.items()
        }


@dataclass(frozen=True)
class SubmissionAuthorization:
    """Trusted dispatch assembled from a queued API receipt and approved snapshot."""

    receipt_id: str
    approval_id: str
    content_digest: str
    status: str = "queued"

    def is_well_formed(self) -> bool:
        return all((self.receipt_id.strip(), self.approval_id.strip(), self.content_digest.strip())) \
            and self.status == "queued"


@dataclass(frozen=True)
class ExecutionRequest:
    job_url: str
    application: ApplicationData
    content_digest: str = ""
    submission: SubmissionAuthorization | None = None

    def fingerprint(self) -> str:
        payload = {
            "job_url": self.job_url,
            "fields": {
                key: {"value": item.value, "sensitive": item.sensitive}
                for key, item in sorted(self.application.normalized_fields().items())
            },
            "resume_path": self.application.resume_path,
            "cover_letter_path": self.application.cover_letter_path,
            "content_digest": self.content_digest,
        }
        encoded = json.dumps(payload, sort_keys=True, ensure_ascii=True, separators=(",", ":"))
        return sha256(encoded.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Blocker:
    kind: BlockerKind
    message: str
    url: str
    details: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class SubmissionReceipt:
    confirmation_number: str | None
    confirmation_url: str
    confirmation_text: str


@dataclass(frozen=True)
class SubmissionCallback:
    """Callback-ready audit outcome; transport and authentication stay with the caller."""

    event_id: str
    receipt_id: str
    status: str
    external_application_id: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ExecutionResult:
    status: ExecutionStatus
    adapter: str | None = None
    fingerprint: str | None = None
    blocker: Blocker | None = None
    receipt: SubmissionReceipt | None = None
    callback: SubmissionCallback | None = None
    submission_receipt_id: str | None = None
    filled_fields: tuple[str, ...] = ()
