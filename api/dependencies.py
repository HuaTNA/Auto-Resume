"""
dependencies.py
FastAPI dependencies shared across routes.
"""

import hmac
import os
import re

import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from api.auth import COOKIE_NAME, decode_token
from api.database import Integration, User, get_db


def _extract_token(request: Request) -> str | None:
    """
    Resolve the JWT from the httpOnly cookie (browser sessions) or,
    failing that, an Authorization: Bearer header (agents, CLI, MCP clients).
    """
    token = request.cookies.get(COOKIE_NAME)
    if token:
        return token
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[len("Bearer "):].strip() or None
    return None


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """
    Validate the JWT from cookie or bearer header.
    Returns the authenticated User or raises HTTP 401.
    """
    token = _extract_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = decode_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired — please log in again")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    # Agent tokens carry scope="agent"; routes can check this to gate destructive ops
    request.state.token_scope = payload.get("scope", "full")

    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return user


_DISCORD_SNOWFLAKE = re.compile(r"^[0-9]{15,22}$")


def get_agent_user(request: Request, db: Session = Depends(get_db)) -> User:
    """Authenticate an Agent API caller from the web session or Discord bridge.

    Service authentication is deliberately limited to a Discord identity that
    the signed-in user connected through the existing Integration resource.
    Holding the service token alone is not enough to select an arbitrary user.
    """
    if request.cookies.get(COOKIE_NAME):
        return get_current_user(request, db)

    configured = os.environ.get("AUTO_RESUME_SERVICE_TOKEN", "").strip()
    authorization = request.headers.get("Authorization", "")
    supplied = authorization.removeprefix("Bearer ").strip() if authorization.startswith("Bearer ") else ""
    if not configured or not supplied or not hmac.compare_digest(configured, supplied):
        raise HTTPException(status_code=401, detail="Invalid Agent service credentials")

    discord_user_id = request.headers.get("X-Discord-User-Id", "").strip()
    discord_channel_id = request.headers.get("X-Discord-Channel-Id", "").strip()
    discord_message_id = request.headers.get("X-Discord-Message-Id", "").strip()
    if not all(_DISCORD_SNOWFLAKE.fullmatch(value) for value in (
        discord_user_id, discord_channel_id, discord_message_id,
    )):
        raise HTTPException(status_code=401, detail="Invalid trusted Discord context")

    bindings = db.query(Integration).filter(
        Integration.provider == "discord",
        Integration.state == "connected",
        Integration.external_account == discord_user_id,
    ).limit(2).all()
    if len(bindings) != 1:
        raise HTTPException(status_code=401, detail="Discord identity is not bound to one account")
    user = db.query(User).filter(User.id == bindings[0].user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="Bound user not found")
    return user
