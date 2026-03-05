"""
ats_scorer.py
Scores the generated resume against the JD for ATS keyword coverage.
Uses keyword matching + Claude semantic analysis.
"""

import json
import re
import anthropic


def _extract_text_from_latex(latex: str) -> str:
    """Strip LaTeX commands to get plain text for keyword matching."""
    text = re.sub(r"\\textbf\{([^}]*)\}", r"\1", latex)
    text = re.sub(r"\\href\{[^}]*\}\{([^}]*)\}", r"\1", latex)
    text = re.sub(r"\\[a-zA-Z]+\{([^}]*)\}", r"\1", text)
    text = re.sub(r"\\[a-zA-Z]+", " ", text)
    text = re.sub(r"[{}\\$%&#~^]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.lower()


def _keyword_match_score(resume_text: str, jd_analysis: dict) -> dict:
    """Check which JD keywords appear in the resume."""
    all_keywords = set()
    for field in ("required_skills", "preferred_skills", "ats_keywords"):
        for kw in jd_analysis.get(field, []):
            all_keywords.add(kw.lower().strip())

    found = set()
    missing = set()
    for kw in all_keywords:
        if kw in resume_text:
            found.add(kw)
        else:
            # Try individual words for multi-word keywords
            words = kw.split()
            if len(words) > 1 and all(w in resume_text for w in words):
                found.add(kw)
            else:
                missing.add(kw)

    score = len(found) / len(all_keywords) * 100 if all_keywords else 0
    return {
        "score": round(score, 1),
        "total_keywords": len(all_keywords),
        "matched": len(found),
        "found": sorted(found),
        "missing": sorted(missing),
    }


def score_resume(resume_tex: str, jd_analysis: dict, client: anthropic.Anthropic) -> dict:
    """
    Score resume against JD using keyword matching + Claude semantic analysis.
    Returns score breakdown and actionable suggestions.
    """
    resume_text = _extract_text_from_latex(resume_tex)
    keyword_result = _keyword_match_score(resume_text, jd_analysis)

    # Claude semantic analysis
    prompt = f"""You are an ATS (Applicant Tracking System) expert. Score this resume against the job requirements.

JOB ANALYSIS:
{json.dumps(jd_analysis, indent=2)}

RESUME TEXT:
{resume_text}

KEYWORD MATCH DATA:
- Matched {keyword_result['matched']}/{keyword_result['total_keywords']} keywords ({keyword_result['score']}%)
- Missing keywords: {', '.join(keyword_result['missing'][:15])}

Evaluate and return ONLY a JSON object (no markdown, no explanation):
{{
  "overall_score": <0-100 integer>,
  "keyword_score": <0-100, how well keywords are covered>,
  "relevance_score": <0-100, how well experience matches responsibilities>,
  "impact_score": <0-100, quality of quantified achievements>,
  "suggestions": [
    "specific actionable suggestion 1",
    "specific actionable suggestion 2",
    "specific actionable suggestion 3"
  ],
  "missing_critical": ["keywords that are MUST-HAVE but missing from resume"],
  "strength": "one sentence about what the resume does well for this JD"
}}"""

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=800,
        messages=[{"role": "user", "content": prompt}]
    )

    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]

    semantic_result = json.loads(raw.strip())

    return {
        "keyword_match": keyword_result,
        "semantic": semantic_result,
    }
