"""
jd_parser.py
Parses a job description using Claude API and extracts structured requirements.
"""

import re
import anthropic
from src.ai_json import request_json

# Sections that contain no useful info for resume tailoring
_NOISE_PATTERNS = [
    # Benefits / compensation
    r"(?i)(?:benefits|compensation|salary|pay range|base salary|bonus \+ equity).*?(?=\n\n|\n(?=[A-Z])|\Z)",
    # Legal disclaimers
    r"(?i)(?:fair chance|equal opportunity|eeo|accommodation|applicants in).*?(?=\n\n|\n(?=[A-Z])|\Z)",
    # Application window
    r"(?i)(?:application window|this opportunity will remain|apply by).*?(?=\n\n|\Z)",
    # Generic perks lists (401k, PTO, insurance...)
    r"(?i)(?:health, dental|retirement benefits|paid time off|sick time|maternity|holidays).*?(?=\n\n|\Z)",
    # Note/disclaimer blocks
    r"(?i)note:\s*by applying.*?(?=\n\n|\Z)",
    # Salary range blocks
    r"(?i)(?:the (?:us|canada) base salary range).*?(?=\n\n|\Z)",
    r"(?i)learn more about benefits.*",
]

# Section headers that signal noise
_NOISE_HEADERS = [
    "why join us", "our benefits", "what we offer", "perks",
    "equal employment", "eeo statement", "accommodation",
]


def clean_jd(jd_text: str) -> str:
    """Remove noise sections (benefits, legal, salary) from JD to save tokens."""
    # Remove regex-matched noise
    cleaned = jd_text
    for pattern in _NOISE_PATTERNS:
        cleaned = re.sub(pattern, "", cleaned, flags=re.DOTALL)

    # Remove entire sections by header
    lines = cleaned.split("\n")
    result = []
    skip = False
    for line in lines:
        header = line.strip().lower().rstrip(":")
        if any(h in header for h in _NOISE_HEADERS):
            skip = True
            continue
        # Stop skipping at next major section header
        if skip and line.strip() and (line[0].isupper() or line.startswith("#")):
            if any(kw in line.lower() for kw in ["responsibilit", "qualificat", "require",
                                                   "about the", "role", "skill", "experience"]):
                skip = False
        if not skip:
            result.append(line)

    # Collapse multiple blank lines
    text = "\n".join(result)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def parse_jd(jd_text: str, client: anthropic.Anthropic) -> dict:
    """
    Parse a job description and return structured requirements.
    """
    jd_cleaned = clean_jd(jd_text)

    prompt = f"""Analyze this job description carefully.

JOB DESCRIPTION:
{jd_cleaned}

Extract ALL of the following. Be thorough — read between the lines.

Return ONLY a JSON object with this exact structure (no markdown, no explanation):
{{
  "job_title": "exact job title from the posting",
  "company": "company name",
  "company_type": "startup | enterprise | research | agency",
  "seniority": "intern | junior | mid | senior | staff",
  "required_skills": ["up to 12 skills"],
  "preferred_skills": ["up to 8 skills"],
  "key_responsibilities": ["up to 8 concise responsibilities"],
  "ats_keywords": ["up to 20 high-value technical keywords, tools, frameworks, and methodologies"],
  "focus_areas": ["up to 6 areas"],
  "soft_requirements": ["up to 6 implied non-technical qualities"],
  "action_verbs": ["up to 8 key verbs used in the JD"],
  "deal_breakers": ["up to 6 absolute must-haves"],
  "bonus_signals": ["up to 6 nice-to-haves"],
  "summary": "2-3 sentence summary of the IDEAL candidate they are looking for, including both technical and soft qualities"
}}

Tips for extraction:
- "customer-facing" or "engaging with stakeholders" = soft requirement for communication
- "prototype", "demo", "workshop" = they want someone who can BUILD and SHOW, not just talk
- "startups" in the title/description = they value speed, adaptability, wearing multiple hats
- Pay attention to verbs: "own" means leadership, "partner" means collaboration, "build" means hands-on
- Keep each list item concise and obey every list limit above"""

    return request_json(
        client,
        prompt,
        expected_type=dict,
        max_tokens=1800,
        retry_tokens=2600,
    )
