#!/usr/bin/env python3
"""
main.py -- AI Resume Generator CLI
Usage:
  python main.py generate --jd path/to/jd.txt              Generate resume + cover letter
  python main.py generate --jd jd.txt --template modern    Use a specific template
  python main.py search --query "ML Engineer" --location ca Search for jobs
  python main.py history                                    View application history
  python main.py templates                                  List available templates
"""

import argparse
import json
import os
import re
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
from src.cover_letter import generate_cover_letter
from src.templates import list_templates, print_template_list
from src.history import add_record, is_duplicate, print_history
from src.job_finder import search_adzuna, rank_jobs, print_job_results


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


def save_output(resume_tex: str, jd_analysis: dict, output_dir: str,
                cover_letter: str = None) -> dict:
    """Save all output files. Returns dict of file paths."""
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    raw_title = jd_analysis.get("job_title", "resume")
    job_title = re.sub(r"[^a-zA-Z0-9]+", "_", raw_title).strip("_").lower()
    base = f"{output_dir}/{timestamp}_{job_title}"

    files = {}

    # Resume .tex and .txt
    tex_file = f"{base}.tex"
    txt_file = f"{base}.txt"
    with open(tex_file, "w", encoding="utf-8") as f:
        f.write(resume_tex)
    with open(txt_file, "w", encoding="utf-8") as f:
        f.write(resume_tex)
    files["tex"] = tex_file
    files["txt"] = txt_file

    # Cover letter
    if cover_letter:
        cl_file = f"{base}_cover_letter.txt"
        with open(cl_file, "w", encoding="utf-8") as f:
            f.write(cover_letter)
        files["cover_letter"] = cl_file

    return files


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


def get_client() -> anthropic.Anthropic:
    """Initialize and return Anthropic client."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("\nError: ANTHROPIC_API_KEY not set.")
        print("Run: export ANTHROPIC_API_KEY=your_key_here\n")
        sys.exit(1)
    return anthropic.Anthropic(api_key=api_key)


# ========== SUBCOMMANDS ==========

def cmd_generate(args):
    """Generate resume + cover letter for a JD."""
    print("\n" + "=" * 50)
    print("  AI Resume Generator -- CLI Prototype")
    print("=" * 50)

    client = get_client()

    # Step 1: Load profile
    total_steps = 7 if not args.no_cover_letter else 6
    print_step(1, total_steps, "Loading profile")
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

    # Clean JD
    original_len = len(jd_text)
    jd_text = clean_jd(jd_text)
    saved = original_len - len(jd_text)
    if saved > 0:
        print(f"     -> Cleaned JD: removed {saved} chars ({saved * 100 // original_len}% noise)")

    # Step 2: Parse JD
    print_step(2, total_steps, "Parsing job description")
    jd_analysis = parse_jd(jd_text, client)
    print_done()
    print(f"     -> {jd_analysis.get('job_title')} ({jd_analysis.get('seniority')})")
    print(f"     -> Required skills: {', '.join(jd_analysis.get('required_skills', [])[:5])}")

    # Check for duplicate
    company = jd_analysis.get("company", "")
    title = jd_analysis.get("job_title", "")
    if is_duplicate(company, title):
        print(f"\n  WARNING: You already generated a resume for {title} @ {company}")
        print(f"  Continuing anyway...\n")

    # Step 3: Retrieve relevant content
    print_step(3, total_steps, f"Retrieving top {args.top_k} relevant bullets")
    filtered_profile = retrieve_relevant_content(profile, jd_analysis, client, top_k=args.top_k)
    total_bullets = sum(len(e["bullets"]) for e in filtered_profile["experiences"]) + \
                    sum(len(p["bullets"]) for p in filtered_profile["projects"])
    print_done()
    print(f"     -> Selected {total_bullets} bullets from your profile")

    # Score thresholds
    THRESHOLDS = {"overall": 80, "keyword_pct": 60, "relevance": 80, "impact": 80}
    MAX_ROUNDS = 3

    # Step 4: Generate resume
    print_step(4, total_steps, f"Generating tailored resume (template: {args.template})")
    resume_tex = generate_resume(filtered_profile, jd_analysis, client,
                                 template_name=args.template)
    print_done()

    # Step 5: ATS Score + optimization loop
    ats_result = None
    for round_num in range(1, MAX_ROUNDS + 1):
        print_step(5, total_steps, f"ATS analysis (round {round_num}/{MAX_ROUNDS})")
        ats_result = score_resume(resume_tex, jd_analysis, client)
        print_done()

        kw = ats_result["keyword_match"]
        sem = ats_result["semantic"]

        print_ats_report(kw, sem)

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

    # Step 6: Cover letter
    cover_letter = None
    if not args.no_cover_letter:
        step_cl = total_steps - 1
        print_step(step_cl, total_steps, "Generating cover letter")
        cover_letter = generate_cover_letter(filtered_profile, jd_analysis, client)
        print_done()

    # Save output
    print_step(total_steps, total_steps, "Saving output files")
    files = save_output(resume_tex, jd_analysis, args.output, cover_letter)
    print_done()

    # Compile PDF
    pdf_file = compile_pdf(files["tex"])
    if pdf_file:
        files["pdf"] = pdf_file

    # Save to history
    record = add_record(
        jd_analysis=jd_analysis,
        ats_scores=ats_result,
        output_files=list(files.values()),
        template=args.template,
    )

    # Summary
    print(f"\n  {'=' * 50}")
    if pdf_file:
        print(f"  PDF:          {pdf_file}")
    else:
        print(f"  PDF compilation failed (is pdflatex installed?)")
    print(f"  LaTeX:        {files['tex']}")
    print(f"  TXT:          {files['txt']}")
    if cover_letter:
        print(f"  Cover Letter: {files['cover_letter']}")
    print(f"  History ID:   #{record['id']}")
    print(f"  {'=' * 50}\n")


def cmd_search(args):
    """Search for jobs and rank by profile fit."""
    print("\n" + "=" * 50)
    print("  AI Job Finder")
    print("=" * 50)

    # Check Adzuna credentials
    app_id = os.environ.get("ADZUNA_APP_ID", "")
    app_key = os.environ.get("ADZUNA_APP_KEY", "")
    if not app_id or not app_key:
        print("\n  To use Job Finder, set Adzuna API credentials in .env:")
        print("    ADZUNA_APP_ID=your_app_id")
        print("    ADZUNA_APP_KEY=your_app_key")
        print("  Get free keys at: https://developer.adzuna.com/")
        sys.exit(1)

    client = get_client()

    # Load profile for ranking
    print(f"\n  Searching for: '{args.query}' in {args.location}...")
    profile = load_profile(args.profile)

    # Search
    jobs = search_adzuna(
        query=args.query,
        location=args.location,
        app_id=app_id,
        app_key=app_key,
        max_results=args.max_results,
    )

    if not jobs:
        print("  No jobs found. Try different keywords or location.")
        return

    print(f"  Found {len(jobs)} jobs. Ranking by profile fit...")

    # Rank
    ranked = rank_jobs(jobs, profile, client, top_n=args.top_n)
    print_job_results(ranked)

    # Offer to generate resume for top pick
    print(f"\n  To generate a resume for a job, copy its description to a .txt file and run:")
    print(f"    python main.py generate --jd path/to/jd.txt\n")


def cmd_history(args):
    """View application history."""
    print_history()

    if args.update:
        from src.history import update_status
        parts = args.update.split(":")
        if len(parts) == 2:
            try:
                record_id = int(parts[0])
                status = parts[1]
                update_status(record_id, status)
                print(f"  Updated #{record_id} -> {status}")
            except (ValueError, Exception) as e:
                print(f"  Error: {e}")
        else:
            print("  Usage: --update ID:STATUS  (e.g. --update 1:applied)")


def cmd_templates(args):
    """List available resume templates."""
    print_template_list()


# ========== CLI SETUP ==========

def main():
    parser = argparse.ArgumentParser(
        description="AI Resume Generator - Generate tailored resumes, cover letters, and find jobs",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python main.py generate --jd job.txt                    Generate resume + cover letter
  python main.py generate --jd job.txt --template modern  Use modern template
  python main.py generate --jd job.txt --no-cover-letter  Skip cover letter
  python main.py search --query "ML Engineer" --location ca
  python main.py history                                  View past applications
  python main.py history --update 1:applied               Update status
  python main.py templates                                List templates
        """
    )
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # generate subcommand
    gen = subparsers.add_parser("generate", help="Generate resume + cover letter for a JD")
    gen.add_argument("--jd", type=str, help="Path to job description text file")
    gen.add_argument("--profile", type=str, default="data/profile.json",
                     help="Path to profile JSON (default: data/profile.json)")
    gen.add_argument("--output", type=str, default="output",
                     help="Output directory (default: output/)")
    gen.add_argument("--top-k", type=int, default=12,
                     help="Number of bullets to retrieve (default: 12)")
    gen.add_argument("--template", type=str, default="classic",
                     help="Resume template: classic, modern, consulting (default: classic)")
    gen.add_argument("--no-cover-letter", action="store_true",
                     help="Skip cover letter generation")

    # search subcommand
    srch = subparsers.add_parser("search", help="Search for jobs from online APIs")
    srch.add_argument("--query", type=str, required=True, help="Job search query")
    srch.add_argument("--location", type=str, default="canada",
                      help="Country/location (default: canada)")
    srch.add_argument("--profile", type=str, default="data/profile.json",
                      help="Path to profile JSON")
    srch.add_argument("--max-results", type=int, default=20)
    srch.add_argument("--top-n", type=int, default=10,
                      help="Show top N ranked results (default: 10)")

    # history subcommand
    hist = subparsers.add_parser("history", help="View application history")
    hist.add_argument("--update", type=str,
                      help="Update record status: ID:STATUS (e.g. 1:applied)")

    # templates subcommand
    subparsers.add_parser("templates", help="List available resume templates")

    args = parser.parse_args()

    if args.command == "generate":
        cmd_generate(args)
    elif args.command == "search":
        cmd_search(args)
    elif args.command == "history":
        cmd_history(args)
    elif args.command == "templates":
        cmd_templates(args)
    else:
        # Backward compatibility: if no subcommand, treat old-style args
        # Check if --jd was passed directly (old usage)
        if len(sys.argv) > 1 and "--jd" in sys.argv:
            # Re-parse with generate defaults
            gen_parser = argparse.ArgumentParser()
            gen_parser.add_argument("--jd", type=str)
            gen_parser.add_argument("--profile", type=str, default="data/profile.json")
            gen_parser.add_argument("--output", type=str, default="output")
            gen_parser.add_argument("--top-k", type=int, default=12)
            gen_parser.add_argument("--template", type=str, default="classic")
            gen_parser.add_argument("--no-cover-letter", action="store_true")
            old_args = gen_parser.parse_args()
            cmd_generate(old_args)
        else:
            parser.print_help()


if __name__ == "__main__":
    main()
