"""Helpers for receiving small, reliable JSON payloads from an LLM."""

from __future__ import annotations

import json
from typing import Any, Type

import anthropic

from src.ai_config import get_anthropic_model


class AIResponseFormatError(RuntimeError):
    """Raised when the model cannot return a complete JSON response."""


def _decode_json(text: str, expected_type: Type) -> Any:
    raw = text.strip()
    if raw.startswith("```"):
        lines = raw.splitlines()
        lines = lines[1:-1] if lines and lines[-1].strip() == "```" else lines[1:]
        if lines and lines[0].strip().lower() == "json":
            lines = lines[1:]
        raw = "\n".join(lines).strip()

    opening, closing = ("{", "}") if expected_type is dict else ("[", "]")
    start, end = raw.find(opening), raw.rfind(closing)
    if start < 0 or end < start:
        raise json.JSONDecodeError("Incomplete JSON response", raw, max(start, 0))
    value = json.loads(raw[start:end + 1])
    if not isinstance(value, expected_type):
        raise TypeError(f"Expected {expected_type.__name__}, got {type(value).__name__}")
    return value


def request_json(
    client: anthropic.Anthropic,
    prompt: str,
    *,
    expected_type: Type,
    max_tokens: int,
    retry_tokens: int | None = None,
) -> Any:
    """Request JSON and retry once when the first response is truncated/malformed."""
    retry_prompt = (
        f"{prompt}\n\n"
        "Your previous attempt was incomplete or invalid. Return compact, valid JSON only. "
        "Do not use markdown. Keep every list within the limits in the requested schema."
    )
    last_error: Exception | None = None
    for attempt, current_prompt in enumerate((prompt, retry_prompt)):
        response = client.messages.create(
            model=get_anthropic_model(),
            max_tokens=max_tokens if attempt == 0 else (retry_tokens or max_tokens),
            messages=[{"role": "user", "content": current_prompt}],
        )
        try:
            return _decode_json(response.content[0].text, expected_type)
        except (json.JSONDecodeError, TypeError, IndexError, AttributeError) as exc:
            last_error = exc

    raise AIResponseFormatError(
        "The AI returned an incomplete response. Please retry generation."
    ) from last_error
