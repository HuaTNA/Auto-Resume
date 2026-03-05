#!/usr/bin/env python3
"""
main.py — AI Resume Generator CLI
Usage:
  python main.py --jd path/to/jd.txt
  python main.py --jd path/to/jd.txt --profile path/to/profile.json
  python main.py  (interactive mode: paste JD in terminal)
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

import anthropic

from src.jd_parser import parse_jd
from src.retriever import retrieve_relevant_content
from src.generator import generate_resume


def load_profile(path: str) -> dict:
    with open(path, "r") as f:
        return json.load(f)


def load_jd(path: str) -> str:
    with open(path, "r") as f:
        return f.read()


def get_jd_interactive() -> str:
    print("\n📋 Paste the job description below.")
    print("   When done, press Enter twice then type 'END' and press Enter:\n")
    lines = []
    while True:
        line = input()
        if line.strip() == "END":
            break
        lines.append(line)
    return "\n".join(lines)


def save_output(resume_md: str, jd_analysis: dict, output_dir: str) -> str:
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    job_title = jd_analysis.get("job_title", "resume").replace(" ", "_").lower()
    filename = f"{output_dir}/{timestamp}_{job_title}.tex"
    with open(filename, "w", encoding="utf-8") as f:
        f.write(resume_md)
    return filename


def print_step(step: int, total: int, label: str):
    print(f"\n  [{step}/{total}] {label}...", end=" ", flush=True)


def print_done():
    print("✓")


def main():
    parser = argparse.ArgumentParser(description="AI Resume Generator")
    parser.add_argument("--jd", type=str, help="Path to job description text file")
    parser.add_argument("--profile", type=str, default="data/profile.json",
                        help="Path to profile JSON (default: data/profile.json)")
    parser.add_argument("--output", type=str, default="output",
                        help="Output directory (default: output/)")
    parser.add_argument("--top-k", type=int, default=12,
                        help="Number of bullets to retrieve (default: 12)")
    args = parser.parse_args()

    # Banner
    print("\n" + "═" * 50)
    print("  🤖  AI Resume Generator  —  CLI Prototype")
    print("═" * 50)

    # Init Anthropic client
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("\n❌  ANTHROPIC_API_KEY not set.")
        print("    Run: export ANTHROPIC_API_KEY=your_key_here\n")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)

    # Load profile
    print_step(1, 4, "Loading profile")
    try:
        profile = load_profile(args.profile)
        print_done()
        print(f"     → {len(profile.get('experiences', []))} experience(s), "
              f"{len(profile.get('projects', []))} project(s)")
    except FileNotFoundError:
        print(f"\n❌  Profile not found: {args.profile}")
        sys.exit(1)

    # Load JD
    if args.jd:
        jd_text = load_jd(args.jd)
    else:
        jd_text = get_jd_interactive()

    if not jd_text.strip():
        print("\n❌  Empty job description.")
        sys.exit(1)

    # Step 2: Parse JD
    print_step(2, 4, "Parsing job description")
    jd_analysis = parse_jd(jd_text, client)
    print_done()
    print(f"     → {jd_analysis.get('job_title')} ({jd_analysis.get('seniority')})")
    print(f"     → Required skills: {', '.join(jd_analysis.get('required_skills', [])[:5])}")

    # Step 3: Retrieve relevant content
    print_step(3, 4, f"Retrieving top {args.top_k} relevant bullets")
    filtered_profile = retrieve_relevant_content(profile, jd_analysis, client, top_k=args.top_k)
    total_bullets = sum(len(e["bullets"]) for e in filtered_profile["experiences"]) + \
                    sum(len(p["bullets"]) for p in filtered_profile["projects"])
    print_done()
    print(f"     → Selected {total_bullets} bullets from your profile")

    # Step 4: Generate resume
    print_step(4, 4, "Generating tailored resume")
    resume_md = generate_resume(filtered_profile, jd_analysis, client)
    print_done()

    # Save output
    output_file = save_output(resume_md, jd_analysis, args.output)

    # Summary
    print("\n" + "═" * 50)
    print(f"  ✅  Resume generated!")
    print(f"  📄  Saved to: {output_file}")
    print("═" * 50)

    # Preview first few lines
    print("\n── Preview ──────────────────────────────────\n")
    preview_lines = resume_md.split("\n")[:20]
    print("\n".join(preview_lines))
    if len(resume_md.split("\n")) > 20:
        print("\n  [... full resume saved to file ...]")
    print()


if __name__ == "__main__":
    main()
