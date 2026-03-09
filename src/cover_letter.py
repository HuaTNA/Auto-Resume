"""
cover_letter.py
Generates a tailored cover letter from filtered profile + JD analysis using Claude.
"""

import json
import anthropic


SYSTEM_PROMPT = """You are an expert cover letter writer for tech roles.

CRITICAL RULES:
1. NEVER fabricate experience. Only use facts provided in the candidate profile.
2. Keep it concise: 3-4 paragraphs, under 400 words total.
3. Mirror the JD's language and keywords naturally.
4. Show enthusiasm for the specific company and role — not generic.
5. Connect the candidate's experience to the job's key responsibilities.
6. Use a professional but personable tone — not robotic.
7. End with a clear call to action.
8. Output ONLY the cover letter text — no explanations, no subject lines, no markdown."""


def generate_cover_letter(filtered_profile: dict, jd_analysis: dict,
                          client: anthropic.Anthropic) -> str:
    """
    Generate a tailored cover letter based on filtered profile and JD analysis.
    Returns plain text cover letter.
    """
    profile_str = json.dumps(filtered_profile, indent=2)
    jd_str = json.dumps(jd_analysis, indent=2)

    prompt = f"""Write a tailored cover letter for this job application.

TARGET JOB ANALYSIS:
{jd_str}

CANDIDATE PROFILE (use ONLY this information):
{profile_str}

COVER LETTER STRUCTURE:
1. OPENING (2-3 sentences):
   - State the role you're applying for and at which company.
   - Lead with your strongest hook: a specific achievement or skill that directly matches the JD's top priority.
   - Show you know something about the company (use company_type, focus_areas from the JD analysis).

2. BODY PARAGRAPH 1 - Technical Fit (3-4 sentences):
   - Connect your most relevant experience to the JD's key_responsibilities and required_skills.
   - Use specific numbers/metrics from your profile.
   - Mirror the JD's action_verbs and terminology.

3. BODY PARAGRAPH 2 - Soft Skills & Culture (2-3 sentences):
   - Address soft_requirements from the JD (collaboration, communication, etc.).
   - Show evidence from your experience (cross-functional work, stakeholder engagement).
   - If the company is a startup, emphasize adaptability and ownership.

4. CLOSING (2-3 sentences):
   - Express genuine enthusiasm for the specific role/team.
   - Clear call to action (looking forward to discussing...).
   - Professional sign-off.

IMPORTANT:
- Do NOT use a generic template feel. Each sentence should feel specific to THIS job.
- Weave in deal_breakers and bonus_signals naturally.
- Keep total length under 400 words.
- Do NOT include a subject line or "Dear Hiring Manager" — start directly with the opening paragraph.
- End with just your name, no address block."""

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1500,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}]
    )

    return response.content[0].text.strip()
