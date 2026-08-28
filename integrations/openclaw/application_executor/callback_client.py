from __future__ import annotations

from dataclasses import asdict
from typing import Any, Mapping, Protocol

from .models import SubmissionCallback
from .settings import OpenClawApplicationSettings


class CallbackTransport(Protocol):
    def post(
        self,
        url: str,
        *,
        headers: Mapping[str, str],
        json: Mapping[str, Any],
    ) -> Mapping[str, Any]: ...


class AutoResumeCallbackClient:
    """Publishes sanitized outcomes through an injected HTTP transport."""

    path = "/api/internal/agent/submission-callbacks"

    def __init__(
        self,
        settings: OpenClawApplicationSettings,
        transport: CallbackTransport,
    ) -> None:
        self.settings = settings
        self.transport = transport

    def publish(self, callback: SubmissionCallback) -> Mapping[str, Any]:
        if not self.settings.auto_resume_api_url:
            raise ValueError("AUTO_RESUME_API_URL is required")
        if not self.settings.auto_resume_webhook_secret:
            raise ValueError("AUTO_RESUME_WEBHOOK_SECRET is required")
        headers = {
            "Content-Type": "application/json",
            "X-Internal-Callback-Secret": self.settings.auto_resume_webhook_secret,
        }
        if self.settings.auto_resume_service_token:
            headers["Authorization"] = f"Bearer {self.settings.auto_resume_service_token}"
        return self.transport.post(
            f"{self.settings.auto_resume_api_url.rstrip('/')}{self.path}",
            headers=headers,
            json=asdict(callback),
        )
