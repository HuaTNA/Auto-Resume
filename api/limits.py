"""Small persistent quota and burst limiter for server-funded API calls."""

import os
import threading
import time
from collections import defaultdict, deque
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from api.database import DailyApiUsage, User


_burst_lock = threading.Lock()
_burst_requests: dict[int, deque[float]] = defaultdict(deque)


def _bounded_env(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError:
        value = default
    return max(minimum, min(value, maximum))


def enforce_external_api_limit(
    db: Session,
    user: User,
    *,
    units: int = 1,
    check_burst: bool = True,
) -> None:
    """Charge usage before a request reaches Anthropic or Adzuna."""
    units = max(1, min(units, 20))
    if check_burst:
        per_minute = _bounded_env("API_REQUESTS_PER_MINUTE", 12, 1, 120)
        now = time.monotonic()
        with _burst_lock:
            requests = _burst_requests[user.id]
            while requests and requests[0] <= now - 60:
                requests.popleft()
            if len(requests) >= per_minute:
                raise HTTPException(
                    status_code=429,
                    detail="Too many AI/API requests. Please wait a minute and try again.",
                    headers={"Retry-After": "60"},
                )
            requests.append(now)

    daily_limit = _bounded_env("API_DAILY_UNITS_PER_USER", 60, 1, 10000)
    usage_date = datetime.utcnow().date().isoformat()
    usage = db.query(DailyApiUsage).filter(
        DailyApiUsage.user_id == user.id,
        DailyApiUsage.usage_date == usage_date,
    ).first()
    current = usage.units if usage else 0
    if current + units > daily_limit:
        raise HTTPException(
            status_code=429,
            detail="Daily AI/API allowance reached. Please try again tomorrow.",
        )
    if usage:
        usage.units = current + units
        usage.updated_at = datetime.utcnow()
    else:
        db.add(DailyApiUsage(user_id=user.id, usage_date=usage_date, units=units))
    db.commit()
