"""
issue_agent_token.py
Issue a long-lived JWT for agent clients (OpenClaw skill, MCP clients, curl).

Usage:
    python scripts/issue_agent_token.py --email you@example.com [--days 90]

Requires the same JWT_SECRET (and DATABASE_URL, if hosted) as the target
backend — run with .env pointed at the deployment you want the token for.
The token carries scope="agent" so the backend can distinguish it from
browser sessions and gate destructive operations.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

load_dotenv()

from api.auth import create_access_token
from api.database import SessionLocal, User


def main() -> int:
    parser = argparse.ArgumentParser(description="Issue a long-lived agent JWT")
    parser.add_argument("--email", required=True, help="Email of an existing user")
    parser.add_argument("--days", type=int, default=90, help="Token lifetime in days (default 90)")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == args.email).first()
        if not user:
            print(f"No user found with email {args.email}", file=sys.stderr)
            return 1
        token = create_access_token(
            user_id=user.id,
            email=user.email,
            expires_hours=args.days * 24,
            scope="agent",
        )
    finally:
        db.close()

    print(f"Agent token for {args.email} (expires in {args.days} days):\n")
    print(token)
    print("\nVerify with:")
    print('  curl -H "Authorization: Bearer <token>" <backend-url>/api/history')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
