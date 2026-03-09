"""
auth.py
Password hashing, JWT creation/verification, and cookie helpers.
"""

import os
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Response

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24
COOKIE_NAME = "access_token"

_fallback_secret: str | None = None


def _get_jwt_secret() -> str:
    secret = os.environ.get("JWT_SECRET")
    if secret:
        return secret

    global _fallback_secret
    if _fallback_secret is None:
        _fallback_secret = secrets.token_hex(32)
        print(
            "WARNING: JWT_SECRET not set in environment. Using a random secret. "
            "Tokens will be invalidated on server restart. Set JWT_SECRET in your .env file."
        )
    return _fallback_secret


def hash_password(plain: str) -> str:
    """Hash a plaintext password with bcrypt."""
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a plaintext password against a bcrypt hash."""
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


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


def set_auth_cookie(response: Response, token: str):
    """Set the auth cookie on the response (httpOnly, SameSite=Lax)."""
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,  # Set to True in production with HTTPS
        max_age=ACCESS_TOKEN_EXPIRE_HOURS * 3600,
        path="/",
    )


def clear_auth_cookie(response: Response):
    """Clear the auth cookie."""
    response.delete_cookie(key=COOKIE_NAME, path="/")
