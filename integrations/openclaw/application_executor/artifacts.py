from __future__ import annotations

import re
from typing import Protocol, Sequence

from .browser import BrowserPage


_TEXT_REDACTIONS = (
    (re.compile(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b"), "[REDACTED_EMAIL]"),
    (re.compile(r"(?<!\w)(?:\+?\d[\d(). -]{7,}\d)(?!\w)"), "[REDACTED_PHONE]"),
    (re.compile(r"(?i)\b(?:authorization|cookie|set-cookie|password|token)\b\s*[:=]\s*\S+"), "[REDACTED_SECRET]"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?\b"), "[REDACTED_TOKEN]"),
    (re.compile(r"(?im)^\s*(?:street\s+)?address\s*[:=].*$"), "[REDACTED_ADDRESS]"),
)

_SENSITIVE_LABELS = (
    "password", "cookie", "authorization", "token", "social security", "ssn",
    "social insurance", "passport", "date of birth", "bank account", "credit card",
)


def sanitize_page_text_for_upload(text: str) -> str:
    sanitized = text
    for pattern, replacement in _TEXT_REDACTIONS:
        sanitized = pattern.sub(replacement, sanitized)
    return sanitized


def page_has_sensitive_controls(page: BrowserPage) -> bool:
    for control in page.controls():
        description = f"{control.kind} {control.name} {control.label}".lower()
        if control.kind == "password" or any(term in description for term in _SENSITIVE_LABELS):
            return True
    return False


class ScreenshotInspector(Protocol):
    """OCR/vision scanner supplied by the uploader; findings must contain no raw secrets."""

    def findings(self, image: bytes) -> Sequence[str]: ...


def assert_screenshot_safe_for_upload(
    page: BrowserPage,
    image: bytes,
    inspector: ScreenshotInspector | None,
) -> None:
    if page_has_sensitive_controls(page):
        raise ValueError("Screenshot upload blocked: page contains sensitive controls")
    if inspector is None:
        raise ValueError("Screenshot upload blocked: no screenshot inspector configured")
    findings = tuple(inspector.findings(image))
    if findings:
        raise ValueError("Screenshot upload blocked: sensitive content detected")
