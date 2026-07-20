"""
job_finder.py
Searches for relevant jobs and scores them against the user's profile.
Supported sources: Indeed via JobSpy and Adzuna (free API key required).
"""

import json
import math
import re
import urllib.request
import urllib.parse
import urllib.error
import anthropic
from src.ai_config import get_anthropic_model


ADZUNA_BASE = "https://api.adzuna.com/v1/api/jobs"


def search_indeed(query: str, location: str = "canada", max_results: int = 20,
                  raise_on_error: bool = False) -> list[dict]:
    """Search Indeed through JobSpy and normalize results to the shared job shape."""
    try:
        from jobspy import scrape_jobs

        frame = scrape_jobs(
            site_name=["indeed"],
            search_term=query,
            location=location,
            country_indeed=_indeed_country(location),
            results_wanted=min(max_results, 50),
        )
    except Exception as exc:
        print(f"  Indeed/JobSpy error: {exc}")
        if raise_on_error:
            raise RuntimeError(f"Indeed/JobSpy error: {exc}") from exc
        return []

    jobs = []
    for item in frame.to_dict(orient="records"):
        url = _clean_value(item.get("job_url"))
        external_id = _clean_value(item.get("id")) or _indeed_job_key(url)
        jobs.append({
            "external_id": external_id,
            "title": _clean_value(item.get("title")),
            "company": _clean_value(item.get("company")) or "Unknown",
            "location": _clean_value(item.get("location")),
            "description": _clean_value(item.get("description")),
            "url": url,
            "salary_min": _clean_number(item.get("min_amount")),
            "salary_max": _clean_number(item.get("max_amount")),
            "created": _clean_value(item.get("date_posted")),
            "source": "indeed",
        })
    return [job for job in jobs if job["title"] and job["url"]]


def search_jobs(query: str, location: str = "canada", sources: list[str] | None = None,
                app_id: str = "", app_key: str = "", max_results: int = 20) -> tuple[list[dict], list[str]]:
    """Search configured sources, preferring Indeed when the same role appears twice."""
    requested = sources or ["indeed", "adzuna"]
    results: list[dict] = []
    warnings: list[str] = []

    if "indeed" in requested:
        try:
            results.extend(search_indeed(query, location, max_results=max_results, raise_on_error=True))
        except RuntimeError as exc:
            warnings.append(str(exc))

    if "adzuna" in requested:
        if app_id and app_key:
            try:
                results.extend(search_adzuna(query, location, app_id, app_key,
                                             max_results=max_results, raise_on_error=True))
            except RuntimeError as exc:
                warnings.append(str(exc))
        else:
            warnings.append("Adzuna is not configured")

    deduplicated: list[dict] = []
    seen: set[str] = set()
    for job in results:
        identity = "|".join(_normalize_identity(job.get(key)) for key in ("company", "title", "location"))
        if identity in seen:
            continue
        seen.add(identity)
        deduplicated.append(job)
    return deduplicated[:max_results], warnings


def search_adzuna(query: str, location: str = "canada", app_id: str = "",
                  app_key: str = "", max_results: int = 20, page: int = 1,
                  raise_on_error: bool = False) -> list[dict]:
    """
    Search Adzuna job listings. Returns list of job dicts.
    Get free API keys at https://developer.adzuna.com/
    """
    country = location.lower().strip()
    # Adzuna uses country codes: ca, us, gb, etc.
    country_map = {
        "canada": "ca", "ca": "ca",
        "us": "us", "usa": "us", "united states": "us",
        "uk": "gb", "gb": "gb", "united kingdom": "gb",
        "australia": "au", "au": "au",
        "germany": "de", "de": "de",
    }
    country_code = country_map.get(country, "ca")

    params = urllib.parse.urlencode({
        "app_id": app_id,
        "app_key": app_key,
        "results_per_page": min(max_results, 50),
        "what": query,
        "content-type": "application/json",
        "sort_by": "relevance",
    })

    url = f"{ADZUNA_BASE}/{country_code}/search/{page}?{params}"

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "AutoResume/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError) as e:
        print(f"  Adzuna API error: {e}")
        if raise_on_error:
            raise RuntimeError(f"Adzuna API error: {e}") from e
        return []

    jobs = []
    for item in data.get("results", []):
        jobs.append({
            "external_id": str(item.get("id", "")),
            "title": item.get("title", ""),
            "company": item.get("company", {}).get("display_name", "Unknown"),
            "location": item.get("location", {}).get("display_name", ""),
            "description": item.get("description", ""),
            "url": item.get("redirect_url", ""),
            "salary_min": item.get("salary_min"),
            "salary_max": item.get("salary_max"),
            "created": item.get("created", ""),
            "source": "adzuna",
        })

    return jobs


def _indeed_country(location: str) -> str:
    value = location.lower().strip()
    if value in {"us", "usa", "united states"}:
        return "USA"
    if value in {"uk", "gb", "united kingdom"}:
        return "UK"
    if value in {"australia", "au"}:
        return "Australia"
    if value in {"germany", "de"}:
        return "Germany"
    return "Canada"


def _clean_value(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    return str(value).strip()


def _clean_number(value) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(parsed) or math.isinf(parsed) else parsed


def _indeed_job_key(url: str) -> str:
    match = re.search(r"[?&]jk=([a-zA-Z0-9]+)", url)
    return match.group(1) if match else url


def _normalize_identity(value) -> str:
    return re.sub(r"[^a-z0-9]+", "", _clean_value(value).lower())


def rank_jobs(jobs: list[dict], profile: dict, client: anthropic.Anthropic,
              top_n: int = 10) -> list[dict]:
    """
    Use Claude to rank/score jobs by fit with the candidate's profile.
    Returns top_n jobs sorted by match score.
    """
    # Build a concise profile summary for scoring
    skills = profile.get("skills", {})
    all_skills = []
    for category, items in skills.items():
        all_skills.extend(items)

    exp_summary = []
    for exp in profile.get("experiences", []):
        exp_summary.append(f"{exp['role']} at {exp['company']}")
    for proj in profile.get("projects", []):
        exp_summary.append(f"Project: {proj['name']} ({proj['stack']})")

    profile_summary = {
        "education": [e["degree"] for e in profile.get("education", [])],
        "skills": all_skills,
        "experience": exp_summary,
    }

    # Truncate job descriptions to save tokens
    jobs_for_scoring = []
    for i, job in enumerate(jobs[:20]):
        jobs_for_scoring.append({
            "index": i,
            "title": job["title"],
            "company": job["company"],
            "description": job["description"][:500],
        })

    prompt = f"""You are a career advisor. Score how well each job matches this candidate's profile.

CANDIDATE PROFILE:
{json.dumps(profile_summary, indent=2)}

JOBS TO SCORE:
{json.dumps(jobs_for_scoring, indent=2)}

For each job, return a match score (0-100) and a one-line reason.

Return ONLY a JSON array (no markdown, no explanation):
[
  {{"index": 0, "score": 85, "reason": "Strong match - requires Python + ML experience"}},
  ...
]

Scoring criteria:
- Required skills overlap with candidate's skills
- Experience level match (candidate is a student/intern level)
- Technology stack alignment
- Role type fit (engineering vs management vs research)"""

    response = client.messages.create(
        model=get_anthropic_model(),
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}]
    )

    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]

    scores = json.loads(raw.strip())

    # Merge scores back into job data
    score_map = {s["index"]: s for s in scores}
    ranked = []
    for i, job in enumerate(jobs[:20]):
        s = score_map.get(i, {"score": 0, "reason": "Not scored"})
        job["match_score"] = s["score"]
        job["match_reason"] = s["reason"]
        ranked.append(job)

    ranked.sort(key=lambda x: x["match_score"], reverse=True)
    return ranked[:top_n]


def print_job_results(jobs: list[dict]):
    """Pretty-print ranked job results."""
    print(f"\n  {'=' * 60}")
    print(f"  TOP JOB MATCHES")
    print(f"  {'=' * 60}")
    for i, job in enumerate(jobs, 1):
        score = job.get("match_score", 0)
        print(f"\n  [{i}] {job['title']} @ {job['company']} (Score: {score}/100)")
        print(f"      Location: {job['location']}")
        if job.get("salary_min") and job.get("salary_max"):
            print(f"      Salary: ${job['salary_min']:,.0f} - ${job['salary_max']:,.0f}")
        print(f"      Reason: {job.get('match_reason', 'N/A')}")
        print(f"      URL: {job['url']}")
    print(f"\n  {'=' * 60}")
