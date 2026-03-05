"""
jd_parser.py
Parses a job description using Claude API and extracts structured requirements.
"""

import json
import re
import anthropic

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

    prompt = f"""Analyze this job description with extreme attention to detail.

JOB DESCRIPTION:
{jd_cleaned}

Extract ALL of the following. Be thorough — read between the lines.

Return ONLY a JSON object with this exact structure (no markdown, no explanation):
{{
  "job_title": "exact job title from the posting",
  "company": "company name",
  "company_type": "startup | enterprise | research | agency",
  "seniority": "intern | junior | mid | senior | staff",
  "required_skills": ["skill1", "skill2"],
  "preferred_skills": ["skill1", "skill2"],
  "key_responsibilities": ["responsibility1", "responsibility2"],
  "ats_keywords": ["every technical keyword, tool, framework, methodology mentioned — be exhaustive"],
  "focus_areas": ["area1", "area2"],
  "soft_requirements": ["implied non-technical qualities like customer-facing, presentation skills, startup mindset, cross-functional collaboration, etc."],
  "action_verbs": ["key verbs used in the JD like build, design, deploy, partner, lead — these reveal what they value"],
  "deal_breakers": ["absolute must-haves that would disqualify a candidate if missing"],
  "bonus_signals": ["nice-to-haves that would make a candidate stand out"],
  "summary": "2-3 sentence summary of the IDEAL candidate they are looking for, including both technical and soft qualities"
}}

Tips for extraction:
- "customer-facing" or "engaging with stakeholders" = soft requirement for communication
- "prototype", "demo", "workshop" = they want someone who can BUILD and SHOW, not just talk
- "startups" in the title/description = they value speed, adaptability, wearing multiple hats
- Pay attention to verbs: "own" means leadership, "partner" means collaboration, "build" means hands-on"""

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
    return json.loads(raw.strip())
