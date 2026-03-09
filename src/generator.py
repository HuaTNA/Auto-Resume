"""
generator.py
Generates a tailored resume from filtered profile + JD analysis using Claude.
Outputs LaTeX using the user's template format.
"""

import json
from pathlib import Path

import anthropic

from src.templates import get_template

TEMPLATE_PATH = Path(__file__).parent.parent / "data" / "template.tex"

SYSTEM_PROMPT = r"""You are an expert resume writer specializing in tech roles.
You output LaTeX code that follows a specific template format.

CRITICAL RULES — follow these without exception:
1. NEVER invent, fabricate, or embellish experience. Only use facts provided to you.
2. You MAY rewrite bullet points to better match the JD's language and keywords — but the substance must remain true.
3. Incorporate relevant ATS keywords from the JD naturally into bullet points where truthful.
4. Use strong action verbs. Quantify impact where numbers are already provided.
5. Keep bullets concise: 1–2 lines max.
6. Output ONLY the LaTeX document — no explanations, no commentary, no markdown fences.
7. Properly escape LaTeX special characters: use \% for %, \$ for $, \& for &, \# for #, \textbf{} for bold.
8. Use \textbf{} to bold key technical terms, metrics, and impact numbers in bullet points.
9. Use --- for em dashes in LaTeX.
10. End each \resumeItem with a period."""


def generate_resume(filtered_profile: dict, jd_analysis: dict, client: anthropic.Anthropic,
                    template_name: str = None) -> str:
    """
    Generate a tailored resume in LaTeX format using the template.
    """

    template = get_template(template_name)
    profile_str = json.dumps(filtered_profile, indent=2)
    jd_str = json.dumps(jd_analysis, indent=2)

    prompt = f"""Generate a tailored resume for this job application using the LaTeX template below.

TARGET JOB ANALYSIS:
{jd_str}

CANDIDATE PROFILE (use ONLY this information):
{profile_str}

LATEX TEMPLATE (follow this structure exactly):
{template}

Instructions:
- Fill in the template placeholders with the candidate's actual data.
- For EDUCATION_ENTRIES, use \\resumeSubheading for each school, then \\resumeItemListStart/End for details (minor, coursework).
- For SKILLS_ENTRIES, use \\resumeItem for each skill category. Reorder skills to put JD-matching skills first within each category.
- For EXPERIENCE_ENTRIES, use \\resumeSubheading for each role, then \\resumeItemListStart/End with \\resumeItem for bullets. Put the most JD-relevant bullets first.
- For PROJECT_ENTRIES, use \\resumeSubheading for each project, then \\resumeItemListStart/End with \\resumeItem for bullets. Only include projects relevant to the JD.
- TAILORING STRATEGY:
  * Mirror the JD's exact terminology. If JD says "cloud native architecture", use that phrase — not "cloud infrastructure".
  * Use the same action verbs from the JD's "action_verbs" field where truthful (e.g., if JD says "own", "partner", "build", prefer those verbs).
  * If JD emphasizes customer-facing / advisory / stakeholder engagement, make sure at least one bullet highlights that.
  * Front-load the most JD-relevant keywords in each bullet (recruiters scan the first few words).
  * Bold technical terms, metrics, and impact numbers that match JD keywords.
- Output the COMPLETE LaTeX document from \\documentclass to \\end{{document}}.
- Do NOT wrap the output in markdown code fences."""

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}]
    )

    return _strip_fences(response.content[0].text.strip())


def refine_resume(current_tex: str, ats_feedback: dict, jd_analysis: dict,
                  filtered_profile: dict, client: anthropic.Anthropic) -> str:
    """
    Refine an existing resume based on ATS feedback.
    """
    feedback_str = json.dumps(ats_feedback, indent=2)
    jd_str = json.dumps(jd_analysis, indent=2)
    profile_str = json.dumps(filtered_profile, indent=2)

    prompt = f"""You previously generated this LaTeX resume. It was scored by an ATS system and needs improvement.

CURRENT RESUME:
{current_tex}

ATS FEEDBACK:
{feedback_str}

JOB ANALYSIS:
{jd_str}

CANDIDATE PROFILE (use ONLY this information — do NOT invent new experience):
{profile_str}

IMPROVEMENT INSTRUCTIONS:
1. Address each suggestion from the ATS feedback.
2. For missing keywords: weave them naturally into existing bullet points WHERE TRUTHFUL.
   - e.g., if "cloud native architecture" is missing and the candidate deployed on Cloud Run, rewrite as "Deployed cloud native application on Google Cloud Run..."
   - Do NOT add keywords that have no basis in the candidate's actual experience.
3. For missing critical keywords that the candidate genuinely lacks experience in — skip them. Do not fabricate.
4. Improve keyword density by using JD terminology as synonyms for what the candidate already did.
5. Keep the same LaTeX template structure. Output the COMPLETE revised LaTeX document.
6. Do NOT wrap output in markdown code fences."""

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}]
    )

    return _strip_fences(response.content[0].text.strip())


def _strip_fences(text: str) -> str:
    """Remove markdown code fences if present."""
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[-1].strip() == "```":
            lines = lines[1:-1]
        else:
            lines = lines[1:]
        if lines and lines[0].strip() in ("latex", "tex"):
            lines = lines[1:]
        return "\n".join(lines)
    return text
