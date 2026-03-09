"""
migrate.py
Initialize the SQLite database and optionally import existing flat-file data.

Usage:
  python -m api.migrate                    # Just create tables
  python -m api.migrate --import-existing  # Also seed from data/profile.json + history/applications.json
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from api.database import init_db, SessionLocal, User, Profile, HistoryRecord
from api.auth import hash_password

PROFILE_PATH = Path(__file__).parent.parent / "data" / "profile.json"
HISTORY_FILE = Path(__file__).parent.parent / "history" / "applications.json"
DEFAULT_EMAIL = "admin@local"
DEFAULT_PASSWORD = "changeme123"


def _import_existing(db):
    """Import flat-file data into DB for a default admin user. Idempotent."""
    # Check if default user already exists
    existing = db.query(User).filter(User.email == DEFAULT_EMAIL).first()
    if existing:
        print(f"  Default user '{DEFAULT_EMAIL}' already exists — skipping import.")
        return

    # Create default user
    user = User(
        email=DEFAULT_EMAIL,
        password_hash=hash_password(DEFAULT_PASSWORD),
        created_at=datetime.utcnow(),
    )
    db.add(user)
    db.flush()  # Get the user.id

    # Import profile
    profile_data = {}
    if PROFILE_PATH.exists():
        try:
            profile_data = json.loads(PROFILE_PATH.read_text(encoding="utf-8"))
            print(f"  Imported profile from {PROFILE_PATH}")
        except Exception as e:
            print(f"  Warning: could not read profile.json: {e}")

    profile = Profile(
        user_id=user.id,
        profile_data=json.dumps(profile_data, ensure_ascii=False),
        updated_at=datetime.utcnow(),
    )
    db.add(profile)

    # Import history
    history_count = 0
    if HISTORY_FILE.exists():
        try:
            records = json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
            for r in records:
                ats = r.get("ats_scores", {})
                hr = HistoryRecord(
                    user_id=user.id,
                    timestamp=r.get("timestamp", datetime.utcnow().isoformat()),
                    job_title=r.get("job_title", "Unknown"),
                    company=r.get("company", "Unknown"),
                    seniority=r.get("seniority", ""),
                    required_skills=json.dumps(r.get("required_skills", [])),
                    template=r.get("template", "classic"),
                    ats_scores=json.dumps(ats),
                    output_files=json.dumps(r.get("output_files", [])),
                    resume_tex=r.get("resume_tex", ""),
                    cover_letter=r.get("cover_letter", ""),
                    status=r.get("status", "generated"),
                )
                db.add(hr)
                history_count += 1
            print(f"  Imported {history_count} history records from {HISTORY_FILE}")
        except Exception as e:
            print(f"  Warning: could not read applications.json: {e}")

    db.commit()
    print(f"  Created default user: email='{DEFAULT_EMAIL}' password='{DEFAULT_PASSWORD}'")
    print("  IMPORTANT: Change the password after first login!")


def main():
    parser = argparse.ArgumentParser(description="Initialize Auto-Resume database")
    parser.add_argument("--import-existing", action="store_true",
                        help="Seed DB from existing flat-file data (profile.json, applications.json)")
    args = parser.parse_args()

    print("[migrate] Initializing database...")
    init_db()
    print("[migrate] Tables created (or already exist).")

    if args.import_existing:
        print("[migrate] Importing existing flat-file data...")
        db = SessionLocal()
        try:
            _import_existing(db)
        finally:
            db.close()

    print("[migrate] Done.")


if __name__ == "__main__":
    main()
