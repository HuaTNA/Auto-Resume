"""Persistent scheduler process for local, Railway, or container deployment."""

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api.database import SessionLocal, init_db
from api.workflows.runner import run_due_automations


def run_once() -> int:
    db = SessionLocal()
    try:
        results = run_due_automations(db)
        if results:
            print(f"Processed {len(results)} scheduled automation(s)")
        return len(results)
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--interval", type=int, default=30)
    args = parser.parse_args()
    init_db()
    if args.once:
        run_once(); return
    while True:
        run_once()
        time.sleep(max(10, min(args.interval, 300)))


if __name__ == "__main__":
    main()
