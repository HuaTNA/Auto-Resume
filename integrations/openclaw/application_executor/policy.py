from __future__ import annotations

from dataclasses import dataclass
import os
from urllib.parse import urlparse


MOCK_ATS_SUFFIX = ".mock-ats.test"


@dataclass(frozen=True)
class ExecutionPolicy:
    allowed_domains: frozenset[str]
    dry_run: bool = True

    @classmethod
    def from_env(cls) -> "ExecutionPolicy":
        domains = frozenset(
            item.strip().lower().lstrip(".")
            for item in os.environ.get("APPLICATION_ALLOWED_DOMAINS", "").split(",")
            if item.strip()
        )
        dry_run = os.environ.get("APPLICATION_DRY_RUN", "true").strip().lower() != "false"
        return cls(domains, dry_run)

    def domain_allowed(self, url: str) -> bool:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        if parsed.scheme not in {"http", "https"} or not host:
            return False
        return any(host == domain or host.endswith(f".{domain}") for domain in self.allowed_domains)

    def submission_allowed(self, url: str) -> bool:
        host = (urlparse(url).hostname or "").lower()
        return self.domain_allowed(url) and (not self.dry_run or host.endswith(MOCK_ATS_SUFFIX))
