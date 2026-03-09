"""
database.py
SQLAlchemy models and session factory for Auto-Resume multi-user storage.
Uses SQLite at data/auto_resume.db (zero infra, works on Windows).
"""

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Generator

from sqlalchemy import (
    Column, Integer, String, Text, DateTime, ForeignKey, UniqueConstraint, create_engine
)
from sqlalchemy.orm import DeclarativeBase, relationship, sessionmaker, Session


def _build_db_url() -> str:
    """
    Resolve DB URL from env when available.
    Falls back to local SQLite for development.
    Supports individual DB_* vars as fallback for passwords with special chars.
    """
    env_url = os.environ.get("DATABASE_URL", "").strip()
    if env_url:
        # SQLAlchemy expects postgresql:// instead of legacy postgres://
        if env_url.startswith("postgres://"):
            return env_url.replace("postgres://", "postgresql://", 1)
        return env_url

    # Build from individual parts (handles special chars in password)
    db_host = os.environ.get("DB_HOST", "").strip()
    if db_host:
        from urllib.parse import quote_plus
        db_user = os.environ.get("DB_USER", "postgres")
        db_pass = quote_plus(os.environ.get("DB_PASSWORD", ""))
        db_port = os.environ.get("DB_PORT", "5432")
        db_name = os.environ.get("DB_NAME", "postgres")
        return f"postgresql://{db_user}:{db_pass}@{db_host}:{db_port}/{db_name}"

    if os.environ.get("VERCEL", "").strip() == "1":
        sqlite_path = Path("/tmp/auto_resume.db")
    else:
        sqlite_path = Path(__file__).parent.parent / "data" / "auto_resume.db"
    return f"sqlite:///{sqlite_path}"


DB_URL = _build_db_url()
IS_SQLITE = DB_URL.startswith("sqlite")

engine_kwargs = {"echo": False}
if IS_SQLITE:
    # Required for FastAPI threading with SQLite.
    engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(DB_URL, **engine_kwargs)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    profile = relationship("Profile", back_populates="user", uselist=False, cascade="all, delete-orphan")
    history_records = relationship("HistoryRecord", back_populates="user", cascade="all, delete-orphan")


class Profile(Base):
    __tablename__ = "profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)
    profile_data = Column(Text, default="{}", nullable=False)  # JSON blob
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="profile")

    def get_data(self) -> dict:
        return json.loads(self.profile_data or "{}")

    def set_data(self, data: dict):
        self.profile_data = json.dumps(data, ensure_ascii=False)


class HistoryRecord(Base):
    __tablename__ = "history_records"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    timestamp = Column(String(50), nullable=False)
    job_title = Column(String(255), default="Unknown")
    company = Column(String(255), default="Unknown")
    seniority = Column(String(100), default="")
    required_skills = Column(Text, default="[]")   # JSON list
    template = Column(String(100), default="classic")
    ats_scores = Column(Text, default="{}")         # JSON dict
    output_files = Column(Text, default="[]")       # JSON list
    resume_tex = Column(Text, default="")
    cover_letter = Column(Text, default="")
    status = Column(String(50), default="generated")

    user = relationship("User", back_populates="history_records")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "timestamp": self.timestamp,
            "job_title": self.job_title,
            "company": self.company,
            "seniority": self.seniority,
            "required_skills": json.loads(self.required_skills or "[]"),
            "template": self.template,
            "ats_scores": json.loads(self.ats_scores or "{}"),
            "output_files": json.loads(self.output_files or "[]"),
            "resume_tex": self.resume_tex,
            "cover_letter": self.cover_letter,
            "status": self.status,
        }


def init_db():
    """Create all tables if they don't exist."""
    if IS_SQLITE:
        sqlite_path = Path(DB_URL.replace("sqlite:///", "", 1))
        sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: yields a DB session and closes it after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
