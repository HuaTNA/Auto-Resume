"""Small deterministic schedule parser shared by API and worker processes."""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo


def next_run_at(schedule: str | None, after: datetime | None = None,
                timezone_name: str = "America/Toronto") -> datetime | None:
    value = (schedule or "manual").strip().lower()
    if value in ("", "manual", "none"):
        return None

    after_utc = (after or datetime.utcnow()).replace(tzinfo=timezone.utc)
    try:
        zone = ZoneInfo(timezone_name)
    except Exception:
        zone = timezone.utc
    local = after_utc.astimezone(zone)

    if value == "hourly":
        candidate = local.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    elif value.startswith("daily@"):
        hour, minute = _time_parts(value.split("@", 1)[1])
        candidate = local.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if candidate <= local:
            candidate += timedelta(days=1)
    elif value.startswith("weekly:"):
        day_part, time_part = value.split(":", 1)[1].split("@", 1)
        weekday = max(0, min(int(day_part), 6))
        hour, minute = _time_parts(time_part)
        days = (weekday - local.weekday()) % 7
        candidate = (local + timedelta(days=days)).replace(hour=hour, minute=minute, second=0, microsecond=0)
        if candidate <= local:
            candidate += timedelta(days=7)
    else:
        return None
    return candidate.astimezone(timezone.utc).replace(tzinfo=None)


def _time_parts(value: str) -> tuple[int, int]:
    try:
        hour, minute = value.split(":", 1)
        return max(0, min(int(hour), 23)), max(0, min(int(minute), 59))
    except (TypeError, ValueError):
        return 9, 0
