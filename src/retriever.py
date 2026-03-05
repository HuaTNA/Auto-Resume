"""
retriever.py
Given a parsed JD and the user's profile, retrieves the most relevant
experience bullets and projects using Claude.
(Prototype: Claude-based retrieval. v2 will use Vertex AI embeddings.)
"""

import json
import anthropic


def retrieve_relevant_content(profile: dict, jd_analysis: dict, client: anthropic.Anthropic, top_k: int = 12) -> dict:
    """
    Select the most relevant bullets from the profile for a given JD.
    Returns a filtered profile with only the most relevant content.
    """

    # Flatten all bullets with their source context
    all_bullets = []

    for exp in profile.get("experiences", []):
        for bullet in exp.get("bullets", []):
            all_bullets.append({
                "id": bullet["id"],
                "source": f"{exp['role']} at {exp['company']}",
                "text": bullet["text"],
                "tags": bullet.get("tags", [])
            })

    for proj in profile.get("projects", []):
        for bullet in proj.get("bullets", []):
            all_bullets.append({
                "id": bullet["id"],
                "source": f"Project: {proj['name']}",
                "text": bullet["text"],
                "tags": bullet.get("tags", [])
            })

    bullets_str = json.dumps(all_bullets, indent=2)
    jd_str = json.dumps(jd_analysis, indent=2)

    prompt = f"""You are a resume expert. Select the {top_k} most relevant experience bullets for this job.

JOB ANALYSIS:
{jd_str}

ALL AVAILABLE BULLETS:
{bullets_str}

Instructions:
- Select the {top_k} bullets that best match the job requirements
- Prioritize bullets that demonstrate required skills, key responsibilities, and ATS keywords
- Return ONLY a JSON array of the selected bullet IDs, ranked by relevance (most relevant first)
- Example: ["b001", "b004", "p001", ...]

Return ONLY the JSON array, nothing else."""

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=500,
        messages=[{"role": "user", "content": prompt}]
    )

    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]

    selected_ids = json.loads(raw.strip())

    # Rebuild filtered profile with only selected bullets
    filtered = {
        "personal": profile["personal"],
        "education": profile["education"],
        "skills": profile["skills"],
        "experiences": [],
        "projects": []
    }

    selected_set = set(selected_ids)

    for exp in profile.get("experiences", []):
        relevant_bullets = [b for b in exp["bullets"] if b["id"] in selected_set]
        if relevant_bullets:
            filtered["experiences"].append({**exp, "bullets": relevant_bullets})

    for proj in profile.get("projects", []):
        relevant_bullets = [b for b in proj["bullets"] if b["id"] in selected_set]
        if relevant_bullets:
            filtered["projects"].append({**proj, "bullets": relevant_bullets})

    return filtered
