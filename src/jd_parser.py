"""
jd_parser.py
Parses a job description using Claude API and extracts structured requirements.
"""

import json
import anthropic


def parse_jd(jd_text: str, client: anthropic.Anthropic) -> dict:
    """
    Parse a job description and return structured requirements.
    """
    prompt = f"""Analyze this job description and extract structured information.

JOB DESCRIPTION:
{jd_text}

Return ONLY a JSON object with this exact structure (no markdown, no explanation):
{{
  "job_title": "exact job title",
  "company_type": "startup | enterprise | research | agency",
  "seniority": "intern | junior | mid | senior | staff",
  "required_skills": ["skill1", "skill2"],
  "preferred_skills": ["skill1", "skill2"],
  "key_responsibilities": ["responsibility1", "responsibility2"],
  "ats_keywords": ["keyword1", "keyword2"],
  "focus_areas": ["area1", "area2"],
  "summary": "2 sentence summary of what they want"
}}"""

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1000,
        messages=[{"role": "user", "content": prompt}]
    )

    raw = response.content[0].text.strip()
    # Strip markdown fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw.strip())
