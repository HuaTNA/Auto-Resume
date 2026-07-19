"""
auth.py
Password hashing, JWT creation/verification, and cookie helpers.
"""

import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

import bcrypt
import jwt
from fastapi import Response

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24
COOKIE_NAME = "access_token"

_fallback_secret: str | None = None


def _get_jwt_secret() -> str:
    secret = os.environ.get("JWT_SECRET", "").strip()
    if len(secret.encode()) >= 32:
        return secret

    production = os.environ.get("PRODUCTION", "").strip().lower() in {"1", "true", "yes", "on"}
    if production:
        raise RuntimeError("JWT_SECRET must be configured with at least 32 bytes in production")

    global _fallback_secret
    if _fallback_secret is None:
        secret_path = Path(__file__).resolve().parent.parent / "data" / ".jwt_secret"
        try:
            _fallback_secret = secret_path.read_text(encoding="utf-8").strip()
        except FileNotFoundError:
            secret_path.parent.mkdir(parents=True, exist_ok=True)
            _fallback_secret = secrets.token_hex(32)
            secret_path.write_text(_fallback_secret, encoding="utf-8")
            secret_path.chmod(0o600)
        if len(_fallback_secret.encode()) < 32:
            raise RuntimeError("Persisted JWT secret is invalid")
        if secret:
            print("WARNING: Ignoring JWT_SECRET shorter than 32 bytes; using the protected local secret file.")
    return _fallback_secret


def get_secret_key() -> str:
    """Return the validated signing secret for other server-side encryption."""
    return _get_jwt_secret()


def hash_password(plain: str) -> str:
    """Hash a plaintext password with bcrypt."""
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a plaintext password against a bcrypt hash."""
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        # Invalid/corrupt hash (e.g. legacy migrated data) — always reject
        return False


def create_access_token(user_id: int, email: str) -> str:
    """Create a signed JWT with user_id and email, expires in 24h."""
    expire = datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    payload = {
        "sub": str(user_id),
        "email": email,
        "exp": expire,
    }
    return jwt.encode(payload, _get_jwt_secret(), algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """
    Decode and validate a JWT.
    Raises jwt.ExpiredSignatureError or jwt.InvalidTokenError on failure.
    """
    return jwt.decode(token, _get_jwt_secret(), algorithms=[JWT_ALGORITHM])


def create_oauth_state(user_id: int, provider: str) -> str:
    """Create a short-lived signed state value for an OAuth redirect."""
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": str(user_id), "provider": provider, "purpose": "oauth", "iat": now, "exp": now + timedelta(minutes=10), "jti": secrets.token_urlsafe(16)}, _get_jwt_secret(), algorithm=JWT_ALGORITHM)


def decode_oauth_state(value: str, provider: str) -> dict:
    payload = jwt.decode(value, _get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    if payload.get("purpose") != "oauth" or payload.get("provider") != provider:
        raise jwt.InvalidTokenError("Invalid OAuth state")
    return payload


def _env_true(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def _cookie_settings() -> tuple[bool, str]:
    """
    Resolve cookie settings from environment.
    """
    # Keep compatibility with older PRODUCTION flag, but prefer explicit vars.
    default_secure = _env_true("COOKIE_SECURE", _env_true("PRODUCTION", _env_true("VERCEL", False)))
    samesite_default = "none" if default_secure else "lax"
    samesite = os.environ.get("COOKIE_SAMESITE", samesite_default).strip().lower()
    if samesite not in ("lax", "strict", "none"):
        samesite = samesite_default
    return default_secure, samesite


def set_auth_cookie(response: Response, token: str):
    """Set the auth cookie on the response."""
    secure, samesite = _cookie_settings()
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite=samesite,
        secure=secure,
        max_age=ACCESS_TOKEN_EXPIRE_HOURS * 3600,
        path="/",
    )


def clear_auth_cookie(response: Response):
    """Clear the auth cookie."""
    response.delete_cookie(key=COOKIE_NAME, path="/")
