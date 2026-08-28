from __future__ import annotations

from abc import ABC, abstractmethod
import re
from typing import Iterable, Sequence
from urllib.parse import urlparse

from .browser import BrowserPage, Control
from .models import ApplicationData, Blocker, BlockerKind, SubmissionReceipt


_SENSITIVE_TERMS = (
    "social security", "ssn", "sin number", "social insurance", "passport",
    "date of birth", "birth date", "bank account", "credit card", "medical",
    "disability", "race", "ethnicity", "religion", "sexual orientation",
    "gender identity", "veteran status", "salary history",
)
_CAPTCHA_TERMS = ("captcha", "recaptcha", "hcaptcha", "verify you are human")
_TWO_FACTOR_TERMS = ("two-factor", "two factor", "2fa", "verification code", "one-time code")
_AUTH_TERMS = ("session expired", "sign in to continue", "log in to continue", "login required")
_CONFIRMATION_TERMS = (
    "application submitted", "application received", "thank you for applying",
    "thanks for applying", "we have received your application",
)
_CONFIRMATION_NUMBER = re.compile(
    r"(?:confirmation|application|reference)\s*(?:number|id|#)?\s*[:#]\s*([A-Z0-9-]{4,})",
    re.IGNORECASE,
)


class AdapterBlocker(RuntimeError):
    def __init__(self, blocker: Blocker):
        super().__init__(blocker.message)
        self.blocker = blocker


class SiteAdapter(ABC):
    name = "base"
    host_patterns: tuple[str, ...] = ()

    def supports(self, page: BrowserPage) -> bool:
        host = (urlparse(page.url).hostname or "").lower()
        return any(host == pattern or host.endswith(f".{pattern}") for pattern in self.host_patterns)

    @abstractmethod
    def submit_locator(self, controls: Sequence[Control]) -> str | None:
        raise NotImplementedError

    def fill(self, page: BrowserPage, data: ApplicationData) -> tuple[str, ...]:
        self.guard_page(page)
        controls = list(page.controls())
        if not controls:
            self._stop(page, BlockerKind.PAGE_STRUCTURE, "No application form controls were found")

        submit_locator = self.submit_locator(controls)
        if not submit_locator:
            self._stop(page, BlockerKind.PAGE_STRUCTURE, "Application submit control was not found")

        answers = data.normalized_fields()
        answer_index = {_normalize(key): (key, value) for key, value in answers.items()}
        filled: list[str] = []
        filled_locators: set[str] = set()
        unresolved_questions: list[str] = []

        for control in controls:
            if control.locator == submit_locator or control.kind in {"submit", "button", "hidden"}:
                continue
            label = control.label or control.name
            normalized = _normalize(label)
            if self._is_sensitive(label):
                match = answer_index.get(normalized)
                if match is None or not match[1].sensitive:
                    self._stop(
                        page, BlockerKind.SENSITIVE_QUESTION,
                        f"Sensitive question requires an explicit sensitive answer: {label}",
                        {"field": label},
                    )
            match = answer_index.get(normalized) or answer_index.get(_normalize(control.name))
            if match is None:
                if control.kind != "file":
                    unresolved_questions.append(label or control.name or control.locator)
                continue
            source_name, value = match
            self._fill_control(page, control, value.value)
            filled.append(source_name)
            filled_locators.add(control.locator)

        resume_locator = self._upload_named_file(
            page, controls, data.resume_path, ("resume", "cv"), filled, "resume",
        )
        cover_locator = self._upload_named_file(
            page, controls, data.cover_letter_path, ("cover letter",), filled, "cover_letter",
        )
        filled_locators.update(locator for locator in (resume_locator, cover_locator) if locator)
        unresolved_files = [
            (control.label or control.name or control.locator)
            for control in controls
            if control.kind == "file" and control.required and control.locator not in filled_locators
        ]
        if unresolved_questions:
            self._stop(
                page, BlockerKind.BLOCKED_QUESTION,
                "A form question could not be mapped to an explicit answer",
                {"fields": unresolved_questions},
            )
        if unresolved_files:
            self._stop(
                page, BlockerKind.PAGE_STRUCTURE,
                "Required application files are missing",
                {"fields": unresolved_files},
            )
        self.guard_page(page)
        return tuple(filled)

    def submit(self, page: BrowserPage, approval_id: str | None) -> None:
        if not approval_id or not approval_id.strip():
            self._stop(page, BlockerKind.APPROVAL_REQUIRED, "A valid approval ID is required to submit")
        self.guard_page(page)
        locator = self.submit_locator(page.controls())
        if not locator:
            self._stop(page, BlockerKind.PAGE_STRUCTURE, "Submit control disappeared before approval")
        page.click(locator)
        page.wait_for_settled()

    def verify_submission(self, page: BrowserPage) -> SubmissionReceipt | None:
        text = page.content_text().strip()
        lowered = text.lower()
        match = _CONFIRMATION_NUMBER.search(text)
        if not match and not any(term in lowered for term in _CONFIRMATION_TERMS):
            return None
        return SubmissionReceipt(
            confirmation_number=match.group(1) if match else None,
            confirmation_url=page.url,
            confirmation_text=text[:1000],
        )

    def guard_page(self, page: BrowserPage) -> None:
        control_text = " ".join(
            f"{control.name} {control.label}" for control in page.controls()
        )
        text = f"{page.content_text()} {control_text}".lower()
        checks = (
            (_CAPTCHA_TERMS, BlockerKind.CAPTCHA, "CAPTCHA requires human intervention"),
            (_TWO_FACTOR_TERMS, BlockerKind.TWO_FACTOR, "Two-factor authentication requires human intervention"),
            (_AUTH_TERMS, BlockerKind.AUTH_EXPIRED, "Authentication is missing or expired"),
        )
        for terms, kind, message in checks:
            if any(term in text for term in terms):
                self._stop(page, kind, message)

    def _fill_control(self, page: BrowserPage, control: Control, value: str | bool) -> None:
        if control.kind in {"checkbox", "radio"}:
            page.check(control.locator, bool(value))
        elif control.kind == "select":
            page.select(control.locator, str(value))
        elif control.kind == "file":
            page.upload(control.locator, str(value))
        else:
            page.fill(control.locator, str(value))

    def _upload_named_file(
        self, page: BrowserPage, controls: Iterable[Control], path: str | None,
        labels: tuple[str, ...], filled: list[str], result_name: str,
    ) -> str | None:
        if not path:
            return None
        for control in controls:
            label = (control.label or control.name).lower()
            if control.kind == "file" and any(term in label for term in labels):
                page.upload(control.locator, path)
                filled.append(result_name)
                return control.locator
        return None

    @staticmethod
    def _is_sensitive(label: str) -> bool:
        lowered = label.lower()
        return any(term in lowered for term in _SENSITIVE_TERMS)

    @staticmethod
    def _stop(
        page: BrowserPage, kind: BlockerKind, message: str, details: dict | None = None,
    ) -> None:
        raise AdapterBlocker(Blocker(kind, message, page.url, details or {}))


class GreenhouseAdapter(SiteAdapter):
    name = "greenhouse"
    host_patterns = ("greenhouse.io", "greenhouse.mock-ats.test")

    def submit_locator(self, controls: Sequence[Control]) -> str | None:
        return _find_submit(controls, ("submit application", "apply"))


class LeverAdapter(SiteAdapter):
    name = "lever"
    host_patterns = ("lever.co", "lever.mock-ats.test")

    def submit_locator(self, controls: Sequence[Control]) -> str | None:
        return _find_submit(controls, ("submit application", "submit", "apply"))


class GenericFormAdapter(SiteAdapter):
    name = "generic"

    def supports(self, page: BrowserPage) -> bool:
        controls = page.controls()
        return bool(controls and self.submit_locator(controls))

    def submit_locator(self, controls: Sequence[Control]) -> str | None:
        return _find_submit(controls, ("submit application", "apply", "submit"))


def _find_submit(controls: Sequence[Control], labels: tuple[str, ...]) -> str | None:
    for control in controls:
        text = (control.label or control.name).strip().lower()
        if control.kind == "submit" and (not text or text in labels):
            return control.locator
    for control in controls:
        text = (control.label or control.name).strip().lower()
        if control.kind == "button" and text in labels:
            return control.locator
    return None


def _normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()
