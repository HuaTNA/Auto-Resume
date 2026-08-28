from __future__ import annotations

from dataclasses import dataclass, field
import os

from .policy import ExecutionPolicy


@dataclass(frozen=True)
class OpenClawApplicationSettings:
    """Environment-only runtime settings. Secret fields are excluded from repr."""

    auto_resume_api_url: str
    openclaw_gateway_url: str
    policy: ExecutionPolicy
    auto_resume_service_token: str = field(default="", repr=False)
    auto_resume_webhook_secret: str = field(default="", repr=False)
    openclaw_gateway_token: str = field(default="", repr=False)

    @classmethod
    def from_env(cls) -> "OpenClawApplicationSettings":
        return cls(
            auto_resume_api_url=os.environ.get("AUTO_RESUME_API_URL", "").strip(),
            auto_resume_service_token=os.environ.get("AUTO_RESUME_SERVICE_TOKEN", "").strip(),
            auto_resume_webhook_secret=os.environ.get("AUTO_RESUME_WEBHOOK_SECRET", "").strip(),
            openclaw_gateway_url=os.environ.get("OPENCLAW_GATEWAY_URL", "").strip(),
            openclaw_gateway_token=os.environ.get("OPENCLAW_GATEWAY_TOKEN", "").strip(),
            policy=ExecutionPolicy.from_env(),
        )
