"""
generator.py
Generates a tailored resume from filtered profile + JD analysis using Claude.
Outputs LaTeX using the user's template format.
"""

import json
from pathlib import Path

import anthropic

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


def generate_resume(filtered_profile: dict, jd_analysis: dict, client: anthropic.Anthropic) -> str:
    """
    Generate a tailored resume in LaTeX format using the template.
    """

    template = TEMPLATE_PATH.read_text(encoding="utf-8")
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
- Tailor bullet text to mirror the JD's language and keywords while keeping facts true.
- Output the COMPLETE LaTeX document from \\documentclass to \\end{{document}}.
- Do NOT wrap the output in markdown code fences."""

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}]
    )

    result = response.content[0].text.strip()
    # Strip markdown fences if present
    if result.startswith("```"):
        lines = result.split("\n")
        # Remove first and last fence lines
        if lines[-1].strip() == "```":
            lines = lines[1:-1]
        else:
            lines = lines[1:]
        # Remove language identifier if present
        if lines and lines[0].strip() in ("latex", "tex"):
            lines = lines[1:]
        result = "\n".join(lines)
    return result
