"""Redact common personal data and credentials before operational log export."""

import re

REDACTIONS = (
    (re.compile(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b"), "[REDACTED_EMAIL]"),
    (re.compile(r"(?<!\w)(?:\+?\d[\d(). -]{7,}\d)(?!\w)"), "[REDACTED_PHONE]"),
    (re.compile(r"(?i)\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+"), "[REDACTED_AUTH]"),
    (re.compile(r"(?i)\b(authorization|token|api[_-]?key|password|cookie|set-cookie)\b\s*[:=]\s*[^\s,;]+"), r"\1=[REDACTED_SECRET]"),
    (re.compile(r"(?i)\b\d{1,6}\s+[A-Za-z0-9.' -]{2,40}\s+(?:street|st|road|rd|avenue|ave|boulevard|blvd|drive|dr)\b[^,\n]*"), "[REDACTED_ADDRESS]"),
)


def redact(value: str) -> str:
    for pattern, replacement in REDACTIONS:
        value = pattern.sub(replacement, value)
    return value
