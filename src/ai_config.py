"""Shared AI provider configuration."""

import os


DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6"


def get_anthropic_model() -> str:
    return os.environ.get("ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL).strip() or DEFAULT_ANTHROPIC_MODEL
