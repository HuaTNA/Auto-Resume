from __future__ import annotations

from collections.abc import Callable, Sequence
from hashlib import sha256

from .adapters import AdapterBlocker, GenericFormAdapter, GreenhouseAdapter, LeverAdapter, SiteAdapter
from .approvals import DenyAllAuthorizations, SubmissionAuthorizationValidator
from .browser import BrowserPage
from .models import (
    Blocker,
    BlockerKind,
    ExecutionRequest,
    ExecutionResult,
    ExecutionStatus,
    SubmissionCallback,
)
from .policy import ExecutionPolicy


BlockerCallback = Callable[[Blocker], None]


class ApplicationExecutor:
    """Fills applications safely and submits only after scoped approval validation."""

    def __init__(
        self,
        page: BrowserPage,
        authorization_validator: SubmissionAuthorizationValidator | None = None,
        on_blocker: BlockerCallback | None = None,
        adapters: Sequence[SiteAdapter] | None = None,
        policy: ExecutionPolicy | None = None,
    ) -> None:
        self.page = page
        self.authorization_validator = authorization_validator or DenyAllAuthorizations()
        self.on_blocker = on_blocker or (lambda blocker: None)
        self.adapters = tuple(adapters or (GreenhouseAdapter(), LeverAdapter(), GenericFormAdapter()))
        self.policy = policy or ExecutionPolicy.from_env()

    def execute(self, request: ExecutionRequest) -> ExecutionResult:
        fingerprint = request.fingerprint()
        adapter: SiteAdapter | None = None
        filled: tuple[str, ...] = ()
        authorization_valid = False
        try:
            if not self.policy.domain_allowed(request.job_url):
                return self._blocked(
                    Blocker(
                        BlockerKind.DOMAIN_NOT_ALLOWED,
                        "Application URL is not in APPLICATION_ALLOWED_DOMAINS",
                        request.job_url,
                    ),
                    fingerprint,
                    request=request,
                )
            if request.submission:
                try:
                    authorization_valid = (
                        request.submission.is_well_formed()
                        and request.content_digest == request.submission.content_digest
                        and self.authorization_validator.validate(request.submission, fingerprint)
                    )
                except Exception as exc:
                    return self._blocked(
                        Blocker(
                            BlockerKind.APPROVAL_REQUIRED,
                            "Queued submission authorization could not be validated; submission was not attempted",
                            request.job_url,
                            {"error": str(exc), "fingerprint": fingerprint},
                        ),
                        fingerprint,
                        request=request,
                    )
                if not authorization_valid:
                    return self._blocked(
                        Blocker(
                            BlockerKind.APPROVAL_REQUIRED,
                            "A valid queued receipt and matching approved content snapshot are required",
                            request.job_url,
                            {"fingerprint": fingerprint},
                        ),
                        fingerprint,
                        request=request,
                    )

            self.page.goto(request.job_url)
            adapter = self._select_adapter()
            if adapter is None:
                return self._blocked(
                    Blocker(BlockerKind.UNSUPPORTED_SITE, "No supported application form was found", self.page.url),
                    fingerprint,
                    request=request,
                    report_outcome=authorization_valid,
                )
            filled = adapter.fill(self.page, request.application)
            if not request.submission:
                return ExecutionResult(
                    status=ExecutionStatus.READY_FOR_APPROVAL,
                    adapter=adapter.name,
                    fingerprint=fingerprint,
                    filled_fields=filled,
                )

            # Re-check immediately before the irreversible external action.
            if not self.policy.submission_allowed(request.job_url):
                return self._blocked(
                    Blocker(
                        BlockerKind.DRY_RUN,
                        "APPLICATION_DRY_RUN blocks submission outside local mock ATS domains",
                        self.page.url,
                    ),
                    fingerprint,
                    adapter.name,
                    filled,
                    request=request,
                    report_outcome=True,
                )
            adapter.guard_page(self.page)
            try:
                adapter.submit(self.page, request.submission.approval_id)
            except AdapterBlocker:
                raise
            except (LookupError, RuntimeError, ValueError) as exc:
                # After click starts, an error is an uncertain external outcome, not a safe retry.
                return self._blocked(
                    Blocker(
                        BlockerKind.SUBMISSION_UNVERIFIED,
                        "Submission may have been attempted but its outcome could not be verified",
                        self.page.url,
                        {"error": str(exc)},
                    ),
                    fingerprint,
                    adapter.name,
                    filled,
                    request=request,
                    report_outcome=True,
                )
            adapter.guard_page(self.page)
            receipt = adapter.verify_submission(self.page)
            if receipt is None:
                return self._blocked(
                    Blocker(
                        BlockerKind.SUBMISSION_UNVERIFIED,
                        "Submit was clicked but no confirmation page or confirmation number was found",
                        self.page.url,
                    ),
                    fingerprint,
                    adapter.name,
                    filled,
                    request=request,
                    report_outcome=True,
                )
            return ExecutionResult(
                status=ExecutionStatus.SUBMITTED,
                adapter=adapter.name,
                fingerprint=fingerprint,
                receipt=receipt,
                callback=self._callback(
                    request,
                    fingerprint,
                    "succeeded",
                    external_application_id=receipt.confirmation_number,
                    metadata={"adapter": adapter.name, "confirmation_verified": True},
                ),
                submission_receipt_id=request.submission.receipt_id,
                filled_fields=filled,
            )
        except AdapterBlocker as exc:
            return self._blocked(
                exc.blocker,
                fingerprint,
                adapter.name if adapter else None,
                filled,
                request=request,
                report_outcome=authorization_valid,
            )
        except (LookupError, RuntimeError, ValueError) as exc:
            return self._blocked(
                Blocker(
                    BlockerKind.PAGE_STRUCTURE,
                    "The application page changed or could not be operated safely",
                    self.page.url,
                    {"error": str(exc)},
                ),
                fingerprint,
                adapter.name if adapter else None,
                filled,
                request=request,
                report_outcome=authorization_valid,
            )

    def _select_adapter(self) -> SiteAdapter | None:
        return next((adapter for adapter in self.adapters if adapter.supports(self.page)), None)

    def _blocked(
        self,
        blocker: Blocker,
        fingerprint: str,
        adapter: str | None = None,
        filled: tuple[str, ...] = (),
        request: ExecutionRequest | None = None,
        report_outcome: bool = False,
    ) -> ExecutionResult:
        self.on_blocker(blocker)
        callback = self._callback(
            request,
            fingerprint,
            "failed",
            error_code=blocker.kind.value,
            error_message=blocker.message,
            metadata={"adapter": adapter or "unknown", "blocker_kind": blocker.kind.value},
        ) if request and report_outcome else None
        return ExecutionResult(
            status=ExecutionStatus.BLOCKED,
            adapter=adapter,
            fingerprint=fingerprint,
            blocker=blocker,
            callback=callback,
            submission_receipt_id=(
                request.submission.receipt_id
                if request and request.submission else None
            ),
            filled_fields=filled,
        )

    def _callback(
        self,
        request: ExecutionRequest,
        fingerprint: str,
        status: str,
        *,
        external_application_id: str | None = None,
        error_code: str | None = None,
        error_message: str | None = None,
        metadata: dict | None = None,
    ) -> SubmissionCallback | None:
        if request.submission is None:
            return None
        event_source = f"{request.submission.receipt_id}:{status}:{fingerprint}"
        event_id = f"openclaw-{sha256(event_source.encode('utf-8')).hexdigest()}"
        return SubmissionCallback(
            event_id=event_id,
            receipt_id=request.submission.receipt_id,
            status=status,
            external_application_id=external_application_id,
            error_code=error_code,
            error_message=error_message,
            metadata=metadata or {},
        )
