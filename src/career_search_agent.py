"""Planning and execution helpers for autonomous career discovery."""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, asdict
from typing import Callable

import anthropic

from src.ai_json import request_json


@dataclass(frozen=True)
class CareerSearchPlan:
    """A bounded, inspectable plan produced before any job-board calls."""

    goal: str
    queries: list[str]
    selection_strategy: str

    def to_dict(self) -> dict:
        return asdict(self)


def plan_career_search(
    profile: dict,
    seed_query: str,
    location: str,
    client: anthropic.Anthropic,
    *,
    max_queries: int = 3,
) -> CareerSearchPlan:
    """Ask the model to turn a profile and a broad preference into search actions."""
    max_queries = max(1, min(int(max_queries), 5))
    prompt = f"""You are a career search agent. Plan a focused job search for this candidate.

CANDIDATE PROFILE:
{json.dumps(_profile_summary(profile), ensure_ascii=False)}

USER'S SEED PREFERENCE: {seed_query}
LOCATION: {location}

Return ONLY one compact JSON object with this schema:
{{
  "goal": "one sentence describing the roles to prioritize",
  "queries": ["job-board query"],
  "selection_strategy": "one sentence explaining the main selection tradeoffs"
}}

Rules:
- Return 1 to {max_queries} distinct queries, from most promising to exploratory.
- Use short job titles or skill + title combinations that work on job boards.
- Respect the candidate's demonstrated seniority; do not default to management roles.
- Keep the user's seed preference represented unless it is blank or unusable.
- Do not include locations, boolean operators, quotation marks, or explanations in queries.
"""
    data = request_json(client, prompt, expected_type=dict, max_tokens=700, retry_tokens=900)
    queries = _clean_queries(data.get("queries"), seed_query, max_queries)
    return CareerSearchPlan(
        goal=_clean_sentence(data.get("goal"), f"Find roles related to {seed_query}"),
        queries=queries,
        selection_strategy=_clean_sentence(
            data.get("selection_strategy"),
            "Prioritize skill overlap, realistic seniority, and role relevance.",
        ),
    )


def fallback_search_plan(seed_query: str) -> CareerSearchPlan:
    query = _clean_query(seed_query) or "Software Engineer"
    return CareerSearchPlan(
        goal=f"Find roles related to {query}",
        queries=[query],
        selection_strategy="Prioritize source relevance until AI planning is available.",
    )


def execute_search_plan(
    plan: CareerSearchPlan,
    search: Callable[..., tuple[list[dict], list[str]]],
    *,
    location: str,
    sources: list[str],
    app_id: str,
    app_key: str,
    max_results: int,
) -> tuple[list[dict], list[str]]:
    """Execute planned queries and merge their results into one deduplicated pool."""
    merged: list[dict] = []
    warnings: list[str] = []
    seen: set[str] = set()
    # Reserve room for every planned direction so the first broad query cannot
    # crowd exploratory queries out of the final candidate pool.
    per_query = max(1, min(50, math.ceil(max_results / len(plan.queries))))

    for query in plan.queries:
        seen_before_query = set(seen)
        identities_in_query: set[str] = set()
        jobs, query_warnings = search(
            query=query,
            location=location,
            sources=sources,
            app_id=app_id,
            app_key=app_key,
            max_results=per_query,
        )
        warnings.extend(f"{query}: {warning}" for warning in query_warnings)
        for job in jobs:
            identity = _job_identity(job)
            # search_jobs already handles duplicates within one provider pass.
            # Only remove overlap introduced by executing additional agent queries;
            # keeping same-pass entries preserves downstream duplicate accounting.
            if identity in seen_before_query:
                continue
            identities_in_query.add(identity)
            enriched = dict(job)
            enriched["search_query"] = query
            merged.append(enriched)
        seen.update(identities_in_query)

    return merged[:max_results], list(dict.fromkeys(warnings))


def _profile_summary(profile: dict) -> dict:
    skills = profile.get("skills", {})
    if isinstance(skills, dict):
        skill_values = [item for values in skills.values() if isinstance(values, list) for item in values]
    elif isinstance(skills, list):
        skill_values = skills
    else:
        skill_values = []
    experiences = []
    for item in profile.get("experiences", []) if isinstance(profile.get("experiences", []), list) else []:
        if isinstance(item, dict):
            experiences.append({key: item.get(key) for key in ("role", "company", "description") if item.get(key)})
    projects = []
    for item in profile.get("projects", []) if isinstance(profile.get("projects", []), list) else []:
        if isinstance(item, dict):
            projects.append({key: item.get(key) for key in ("name", "stack", "description") if item.get(key)})
    return {
        "headline": profile.get("headline") or profile.get("summary") or "",
        "skills": [str(item) for item in skill_values[:30]],
        "experiences": experiences[:6],
        "projects": projects[:6],
    }


def _clean_queries(value, seed_query: str, maximum: int) -> list[str]:
    items = value if isinstance(value, list) else []
    cleaned: list[str] = []
    for item in items:
        query = _clean_query(item)
        if query and query.casefold() not in {existing.casefold() for existing in cleaned}:
            cleaned.append(query)
        if len(cleaned) >= maximum:
            break
    fallback = _clean_query(seed_query)
    if not cleaned and fallback:
        cleaned.append(fallback)
    return cleaned or ["Software Engineer"]


def _clean_query(value) -> str:
    text = re.sub(r"[\"'()]", "", str(value or ""))
    text = re.sub(r"\s+", " ", text).strip(" ,;-|")
    return text[:100]


def _clean_sentence(value, fallback: str) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return (text or fallback)[:500]


def _job_identity(job: dict) -> str:
    company = re.sub(r"[^a-z0-9]+", "", str(job.get("company") or "").lower())
    title = re.sub(r"[^a-z0-9]+", "", str(job.get("title") or "").lower())
    return f"{company}|{title}"
