"""
job_finder.py
Searches for relevant jobs from free APIs and scores them against the user's profile.
Supported sources: Adzuna (free API key required).
"""

import json
import urllib.request
import urllib.parse
import urllib.error
import anthropic


ADZUNA_BASE = "https://api.adzuna.com/v1/api/jobs"


def search_adzuna(query: str, location: str = "canada", app_id: str = "",
                  app_key: str = "", max_results: int = 20, page: int = 1) -> list[dict]:
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
        return []

    jobs = []
    for item in data.get("results", []):
        jobs.append({
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
        model="claude-sonnet-4-20250514",
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
