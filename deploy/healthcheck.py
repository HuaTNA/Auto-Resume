#!/usr/bin/env python3
"""Dependency-free production health probe with secret-safe output."""

import json
import os
import sys
from urllib.error import URLError
from urllib.request import Request, urlopen


def main() -> int:
    base_url = os.environ.get("HEALTHCHECK_BASE_URL", "http://127.0.0.1:8080").rstrip("/")
    require_postgres = os.environ.get("HEALTHCHECK_REQUIRE_POSTGRES", "false").lower() in {"1", "true", "yes"}
    try:
        request = Request(f"{base_url}/api/health", headers={"User-Agent": "auto-resume-healthcheck/1"})
        with urlopen(request, timeout=8) as response:
            payload = json.load(response)
    except (OSError, URLError, ValueError) as exc:
        print(json.dumps({"status": "unhealthy", "reason": type(exc).__name__}))
        return 1
    healthy = payload.get("status") == "ok" and (not require_postgres or payload.get("db") == "postgresql")
    print(json.dumps({"status": "ok" if healthy else "unhealthy", "db": payload.get("db", "unknown")}))
    return 0 if healthy else 1


if __name__ == "__main__":
    sys.exit(main())
