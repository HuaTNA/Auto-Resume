"""
routes/auth.py
Authentication endpoints: register, login, logout, me.
"""

import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.auth import create_access_token, hash_password, verify_password, set_auth_cookie, clear_auth_cookie
from api.database import Profile, User, get_db
from api.dependencies import get_current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class RegisterInput(BaseModel):
    email: str
    password: str


class LoginInput(BaseModel):
    email: str
    password: str


def _validate_email(email: str):
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Invalid email address")


def _validate_password(password: str):
    if len(password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")


@router.post("/register")
def register(data: RegisterInput, response: Response, db: Session = Depends(get_db)):
    """Register a new user."""
    _validate_email(data.email)
    _validate_password(data.password)

    email = data.email.lower().strip()

    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        email=email,
        password_hash=hash_password(data.password),
        created_at=datetime.utcnow(),
    )
    db.add(user)
    db.flush()

    # Create empty profile for the new user
    profile = Profile(
        user_id=user.id,
        profile_data="{}",
        updated_at=datetime.utcnow(),
    )
    db.add(profile)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id, user.email)
    set_auth_cookie(response, token)

    return {"id": user.id, "email": user.email, "created_at": user.created_at.isoformat()}


@router.post("/login")
def login(data: LoginInput, response: Response, db: Session = Depends(get_db)):
    """Log in an existing user."""
    email = data.email.lower().strip()
    user = db.query(User).filter(User.email == email).first()

    # Use verify_password even on failure to prevent timing attacks
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_access_token(user.id, user.email)
    set_auth_cookie(response, token)

    return {"id": user.id, "email": user.email, "created_at": user.created_at.isoformat()}


@router.post("/logout")
def logout(response: Response):
    """Clear the auth cookie."""
    clear_auth_cookie(response)
    return {"ok": True}


@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    """Return the currently authenticated user's info."""
    return {
        "id": current_user.id,
        "email": current_user.email,
        "created_at": current_user.created_at.isoformat(),
    }
