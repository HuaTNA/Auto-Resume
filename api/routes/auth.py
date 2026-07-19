"""
routes/auth.py
Authentication endpoints: register, login, logout, me.
"""

import os
import re
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from api.auth import create_access_token, hash_password, verify_password, set_auth_cookie, clear_auth_cookie
from api.database import (
    AIConversation, AIMessage, Automation, AutomationRun, CareerApplication, DailyApiUsage, GenerationJob,
    CareerJob, CareerJobMatch, Document, DocumentVersion, HistoryRecord,
    Integration, InterviewNote, KnowledgeItem, Notification, Profile, User,
    WorkspaceActivity, WorkspaceProject, WorkspaceTask, get_db,
)
from api.dependencies import get_current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class RegisterInput(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=128)
    invite_code: str | None = Field(default=None, max_length=256)


class LoginInput(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=128)


class PasswordChangeInput(BaseModel):
    current_password: str
    new_password: str


class AccountDeleteInput(BaseModel):
    password: str


def _validate_email(email: str):
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Invalid email address")


def _validate_password(password: str):
    if len(password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    if len(password.encode("utf-8")) > 72:
        raise HTTPException(status_code=422, detail="Password must be at most 72 UTF-8 bytes")


def _registration_mode() -> str:
    configured = os.environ.get("REGISTRATION_MODE", "").strip().lower()
    if configured in {"open", "invite", "closed"}:
        return configured
    production = os.environ.get("PRODUCTION", "").strip().lower() in {"1", "true", "yes", "on"}
    return "invite" if production else "open"


def _authorize_registration(invite_code: str | None) -> None:
    mode = _registration_mode()
    if mode == "closed":
        raise HTTPException(status_code=403, detail="Registration is currently closed")
    if mode != "invite":
        return
    expected = os.environ.get("REGISTRATION_INVITE_CODE", "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="Invite-only registration is not configured")
    supplied = (invite_code or "").strip()
    if not supplied or not secrets.compare_digest(supplied, expected):
        raise HTTPException(status_code=403, detail="A valid invitation code is required")


@router.get("/registration-config")
def registration_config():
    """Expose only whether the signup form needs an invite code."""
    return {"mode": _registration_mode()}


@router.post("/register")
def register(data: RegisterInput, response: Response, db: Session = Depends(get_db)):
    """Register a new user."""
    _authorize_registration(data.invite_code)
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


@router.post("/change-password")
def change_password(data: PasswordChangeInput, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(data.current_password, current_user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    _validate_password(data.new_password)
    if data.current_password == data.new_password:
        raise HTTPException(status_code=422, detail="New password must be different")
    current_user.password_hash = hash_password(data.new_password)
    db.commit()
    return {"ok": True}


def _export_row(row, excluded: set[str] | None = None) -> dict:
    excluded = {"id", "user_id"} | (excluded or set())
    output = {}
    for column in row.__table__.columns:
        if column.name in excluded: continue
        value = getattr(row, column.name)
        output[column.name] = value.isoformat() if isinstance(value, datetime) else value
    return output


@router.get("/export")
def export_account(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    models = {
        "projects": WorkspaceProject, "tasks": WorkspaceTask, "knowledge": KnowledgeItem,
        "activities": WorkspaceActivity, "documents": Document, "document_versions": DocumentVersion,
        "career_history": HistoryRecord, "career_jobs": CareerJob, "career_applications": CareerApplication,
        "interview_notes": InterviewNote, "automations": Automation, "automation_runs": AutomationRun,
        "notifications": Notification, "conversations": AIConversation, "messages": AIMessage,
        "daily_api_usage": DailyApiUsage,
        "generation_jobs": GenerationJob,
    }
    data = {name: [_export_row(row) for row in db.query(model).filter(model.user_id == current_user.id).all()] for name, model in models.items()}
    profile = db.query(Profile).filter(Profile.user_id == current_user.id).first()
    integrations = db.query(Integration).filter(Integration.user_id == current_user.id).all()
    return {"version": 1, "exported_at": datetime.utcnow().isoformat(), "account": {"email": current_user.email, "created_at": current_user.created_at.isoformat()}, "profile": profile.get_data() if profile else {}, "integrations": [_export_row(row, {"config_json"}) for row in integrations], **data}


@router.delete("/account")
def delete_account(data: AccountDeleteInput, response: Response, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(data.password, current_user.password_hash):
        raise HTTPException(status_code=401, detail="Password is incorrect")
    user_id = current_user.id
    ordered_models = [AIMessage, CareerJobMatch, AutomationRun, Notification, DocumentVersion, InterviewNote, GenerationJob, CareerApplication, AIConversation, Document, WorkspaceActivity, WorkspaceTask, WorkspaceProject, KnowledgeItem, DailyApiUsage, Automation, Integration, CareerJob, HistoryRecord, Profile]
    for model in ordered_models:
        db.query(model).filter(model.user_id == user_id).delete(synchronize_session=False)
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit(); clear_auth_cookie(response)
    return {"ok": True}
