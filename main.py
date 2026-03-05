#!/usr/bin/env python3
"""
main.py -- AI Resume Generator CLI
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

from dotenv import load_dotenv
import anthropic

load_dotenv()

from src.jd_parser import parse_jd, clean_jd
from src.retriever import retrieve_relevant_content
from src.generator import generate_resume, refine_resume
from src.ats_scorer import score_resume


def load_profile(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_jd(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def get_jd_interactive() -> str:
    print("\nPaste the job description below.")
    print("When done, press Enter twice then type 'END' and press Enter:\n")
    lines = []
    while True:
        line = input()
        if line.strip() == "END":
            break
        lines.append(line)
    return "\n".join(lines)


def save_output(resume_tex: str, jd_analysis: dict, output_dir: str) -> str:
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    import re
    raw_title = jd_analysis.get("job_title", "resume")
    job_title = re.sub(r"[^a-zA-Z0-9]+", "_", raw_title).strip("_").lower()
    base = f"{output_dir}/{timestamp}_{job_title}"
    tex_file = f"{base}.tex"
    txt_file = f"{base}.txt"
    with open(tex_file, "w", encoding="utf-8") as f:
        f.write(resume_tex)
    # Plain text version for easy copy-paste / Overleaf editing
    with open(txt_file, "w", encoding="utf-8") as f:
        f.write(resume_tex)
    return tex_file


def compile_pdf(tex_path: str) -> str | None:
    """Compile .tex to .pdf using pdflatex. Returns pdf path or None on failure."""
    import subprocess
    tex_dir = str(Path(tex_path).parent)
    tex_name = Path(tex_path).name
    try:
        subprocess.run(
            ["pdflatex", "-interaction=nonstopmode", tex_name],
            cwd=tex_dir,
            capture_output=True,
            timeout=60,
        )
        pdf_path = tex_path.replace(".tex", ".pdf")
        if Path(pdf_path).exists():
            # Clean up auxiliary files
            for ext in (".aux", ".log", ".out"):
                aux = tex_path.replace(".tex", ext)
                if Path(aux).exists():
                    Path(aux).unlink()
            return pdf_path
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return None


def print_ats_report(kw: dict, sem: dict):
    print(f"\n  {'=' * 50}")
    print(f"  ATS SCORE REPORT")
    print(f"  {'=' * 50}")
    print(f"  Overall Score:   {sem['overall_score']}/100")
    print(f"  Keyword Match:   {kw['matched']}/{kw['total_keywords']} ({kw['score']}%)")
    print(f"  Relevance:       {sem['relevance_score']}/100")
    print(f"  Impact:          {sem['impact_score']}/100")
    print(f"  {'-' * 50}")
    print(f"  Strength: {sem['strength']}")

    if sem.get("missing_critical"):
        print(f"\n  MISSING CRITICAL KEYWORDS:")
        for mk in sem["missing_critical"]:
            print(f"    ! {mk}")

    if kw["missing"]:
        print(f"\n  Missing keywords ({len(kw['missing'])}):")
        for mk in kw["missing"][:10]:
            print(f"    - {mk}")
        if len(kw["missing"]) > 10:
            print(f"    ... and {len(kw['missing']) - 10} more")

    if sem.get("suggestions"):
        print(f"\n  Suggestions:")
        for i, s in enumerate(sem["suggestions"], 1):
            print(f"    {i}. {s}")


def print_step(step: int, total: int, label: str):
    print(f"\n  [{step}/{total}] {label}...", end=" ", flush=True)


def print_done():
    print("done")


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
    print("\n" + "=" * 50)
    print("  AI Resume Generator -- CLI Prototype")
    print("=" * 50)

    # Init Anthropic client
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("\nError: ANTHROPIC_API_KEY not set.")
        print("Run: export ANTHROPIC_API_KEY=your_key_here\n")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)

    # Load profile
    print_step(1, 5, "Loading profile")
    try:
        profile = load_profile(args.profile)
        print_done()
        print(f"     -> {len(profile.get('experiences', []))} experience(s), "
              f"{len(profile.get('projects', []))} project(s)")
    except FileNotFoundError:
        print(f"\nError: Profile not found: {args.profile}")
        sys.exit(1)

    # Load JD
    if args.jd:
        jd_text = load_jd(args.jd)
    else:
        jd_text = get_jd_interactive()

    if not jd_text.strip():
        print("\nError: Empty job description.")
        sys.exit(1)

    # Clean JD to save tokens
    original_len = len(jd_text)
    jd_text = clean_jd(jd_text)
    saved = original_len - len(jd_text)
    if saved > 0:
        print(f"     -> Cleaned JD: removed {saved} chars ({saved * 100 // original_len}% noise)")


    # Step 2: Parse JD
    print_step(2, 5, "Parsing job description")
    jd_analysis = parse_jd(jd_text, client)
    print_done()
    print(f"     -> {jd_analysis.get('job_title')} ({jd_analysis.get('seniority')})")
    print(f"     -> Required skills: {', '.join(jd_analysis.get('required_skills', [])[:5])}")

    # Step 3: Retrieve relevant content
    print_step(3, 5, f"Retrieving top {args.top_k} relevant bullets")
    filtered_profile = retrieve_relevant_content(profile, jd_analysis, client, top_k=args.top_k)
    total_bullets = sum(len(e["bullets"]) for e in filtered_profile["experiences"]) + \
                    sum(len(p["bullets"]) for p in filtered_profile["projects"])
    print_done()
    print(f"     -> Selected {total_bullets} bullets from your profile")

    # Score thresholds
    THRESHOLDS = {"overall": 80, "keyword_pct": 60, "relevance": 80, "impact": 80}
    MAX_ROUNDS = 3

    # Step 4: Generate resume
    print_step(4, 5, "Generating tailored resume (LaTeX)")
    resume_tex = generate_resume(filtered_profile, jd_analysis, client)
    print_done()

    # Step 5: ATS Score + optimization loop
    for round_num in range(1, MAX_ROUNDS + 1):
        print_step(5, 5, f"ATS analysis (round {round_num}/{MAX_ROUNDS})")
        ats_result = score_resume(resume_tex, jd_analysis, client)
        print_done()

        kw = ats_result["keyword_match"]
        sem = ats_result["semantic"]

        print_ats_report(kw, sem)

        # Check if thresholds met
        passed = (
            sem["overall_score"] >= THRESHOLDS["overall"]
            and kw["score"] >= THRESHOLDS["keyword_pct"]
            and sem["relevance_score"] >= THRESHOLDS["relevance"]
            and sem["impact_score"] >= THRESHOLDS["impact"]
        )

        if passed:
            print(f"\n  >> All thresholds met!")
            break

        if round_num < MAX_ROUNDS:
            print(f"\n  >> Below threshold, refining...")
            resume_tex = refine_resume(
                resume_tex, ats_result, jd_analysis, filtered_profile, client
            )
        else:
            print(f"\n  >> Max rounds reached. Saving best result.")

    # Save output
    output_file = save_output(resume_tex, jd_analysis, args.output)

    # Compile PDF
    pdf_file = compile_pdf(output_file)

    # Summary
    print(f"\n  {'=' * 50}")
    if pdf_file:
        print(f"  PDF:   {pdf_file}")
    else:
        print(f"  PDF compilation failed (is pdflatex installed?)")
    print(f"  LaTeX: {output_file}")
    print(f"  TXT:   {output_file.replace('.tex', '.txt')}")
    print(f"  {'=' * 50}\n")


if __name__ == "__main__":
    main()
