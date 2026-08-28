from __future__ import annotations

from typing import Protocol

from .models import SubmissionAuthorization


class SubmissionAuthorizationValidator(Protocol):
    """Validates a queued API receipt against the exact browser execution."""

    def validate(self, authorization: SubmissionAuthorization, fingerprint: str) -> bool: ...


class DenyAllAuthorizations:
    def validate(self, authorization: SubmissionAuthorization, fingerprint: str) -> bool:
        return False
