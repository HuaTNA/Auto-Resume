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
    Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint,
    create_engine, inspect, text
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
        db_user = quote_plus(os.environ.get("DB_USER", "postgres"))
        db_pass = quote_plus(os.environ.get("DB_PASSWORD", ""))
        db_port = os.environ.get("DB_PORT", "5432")
        db_name = quote_plus(os.environ.get("DB_NAME", "postgres"))
        db_sslmode = quote_plus(os.environ.get("DB_SSLMODE", "require"))
        return f"postgresql://{db_user}:{db_pass}@{db_host}:{db_port}/{db_name}?sslmode={db_sslmode}"

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
else:
    # Keep each serverless instance's local pool deliberately small. Supabase's
    # transaction pooler multiplexes these client connections across Postgres.
    engine_kwargs.update({
        "pool_pre_ping": True,
        "pool_recycle": 300,
        "pool_size": max(1, int(os.environ.get("DB_POOL_SIZE", "3"))),
        "max_overflow": max(0, int(os.environ.get("DB_MAX_OVERFLOW", "2"))),
    })

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


class CareerJob(Base):
    __tablename__ = "career_jobs"
    __table_args__ = (UniqueConstraint("user_id", "company", "title", name="uq_career_job_identity"),)

    id = Column(Integer, primary_key=True)
    public_id = Column(String(64), nullable=False, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    company = Column(String(255), nullable=False)
    seniority = Column(String(100), default="", nullable=False)
    required_skills = Column(Text, default="[]", nullable=False)
    source_key = Column(String(64), nullable=True, index=True)
    source = Column(String(64), default="manual", nullable=False)
    source_url = Column(Text, nullable=True)
    location = Column(String(255), default="", nullable=False)
    source_payload = Column(Text, default="{}", nullable=False)
    jd_text = Column(Text, default="", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class CareerApplication(Base):
    __tablename__ = "career_applications"
    __table_args__ = (UniqueConstraint("user_id", "history_record_id", name="uq_career_application_history"),)

    id = Column(Integer, primary_key=True)
    public_id = Column(String(64), nullable=False, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    job_id = Column(Integer, ForeignKey("career_jobs.id"), nullable=False, index=True)
    history_record_id = Column(Integer, ForeignKey("history_records.id"), nullable=False, index=True)
    status = Column(String(50), default="generated", nullable=False)
    approval_status = Column(String(32), default="pending", nullable=False)
    match_score = Column(Integer, default=0, nullable=False)
    automation_id = Column(Integer, ForeignKey("automations.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class WorkspaceProject(Base):
    __tablename__ = "workspace_projects"
    __table_args__ = (UniqueConstraint("user_id", "public_id", name="uq_workspace_project_user_public"),)

    id = Column(Integer, primary_key=True)
    public_id = Column(String(64), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    summary = Column(Text, default="", nullable=False)
    status = Column(String(32), default="active", nullable=False)
    progress = Column(Integer, default=0, nullable=False)
    next_action = Column(Text, default="", nullable=False)
    due_date = Column(String(32), nullable=True)
    tags = Column(Text, default="[]", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class WorkspaceTask(Base):
    __tablename__ = "workspace_tasks"
    __table_args__ = (UniqueConstraint("user_id", "public_id", name="uq_workspace_task_user_public"),)

    id = Column(Integer, primary_key=True)
    public_id = Column(String(64), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    status = Column(String(32), default="todo", nullable=False)
    priority = Column(String(32), default="medium", nullable=False)
    due_date = Column(String(32), nullable=True)
    tags = Column(Text, default="[]", nullable=False)
    project_id = Column(String(64), nullable=True, index=True)
    related_job_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class KnowledgeItem(Base):
    __tablename__ = "knowledge_items"
    __table_args__ = (UniqueConstraint("user_id", "public_id", name="uq_knowledge_item_user_public"),)

    id = Column(Integer, primary_key=True)
    public_id = Column(String(64), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    kind = Column(String(32), default="note", nullable=False)
    title = Column(String(255), nullable=False)
    content = Column(Text, default="", nullable=False)
    url = Column(Text, nullable=True)
    tags = Column(Text, default="[]", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class WorkspaceActivity(Base):
    __tablename__ = "workspace_activities"

    id = Column(Integer, primary_key=True)
    public_id = Column(String(64), nullable=False, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    module = Column(String(32), nullable=False)
    action = Column(String(32), nullable=False)
    entity_type = Column(String(32), nullable=False)
    entity_id = Column(String(64), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (UniqueConstraint("user_id", "public_id", name="uq_document_user_public"),)

    id = Column(Integer, primary_key=True)
    public_id = Column(String(64), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    kind = Column(String(50), default="document", nullable=False)
    owner_module = Column(String(32), default="documents", nullable=False)
    status = Column(String(32), default="active", nullable=False)
    source_record_id = Column(Integer, ForeignKey("history_records.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class DocumentVersion(Base):
    __tablename__ = "document_versions"
    __table_args__ = (UniqueConstraint("document_id", "version_number", name="uq_document_version_number"),)

    id = Column(Integer, primary_key=True)
    public_id = Column(String(64), nullable=False, unique=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    version_number = Column(Integer, default=1, nullable=False)
    content = Column(Text, default="", nullable=False)
    storage_path = Column(Text, nullable=True)
    metadata_json = Column(Text, default="{}", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class InterviewNote(Base):
    __tablename__ = "interview_notes"

    id = Column(Integer, primary_key=True)
    public_id = Column(String(64), nullable=False, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    application_record_id = Column(Integer, ForeignKey("history_records.id"), nullable=False, index=True)
    kind = Column(String(32), default="note", nullable=False)
    title = Column(String(255), nullable=False)
    content = Column(Text, default="", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class Automation(Base):
    __tablename__ = "automations"

    id = Column(Integer, primary_key=True)
    public_id = Column(String(64), nullable=False, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    kind = Column(String(64), default="manual", nullable=False)
    schedule = Column(String(255), nullable=True)
    enabled = Column(Boolean, default=True, nullable=False)
    config_json = Column(Text, default="{}", nullable=False)
    max_retries = Column(Integer, default=2, nullable=False)
    next_run_at = Column(DateTime, nullable=True, index=True)
    last_run_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class AutomationRun(Base):
    __tablename__ = "automation_runs"

    id = Column(Integer, primary_key=True)
    public_id = Column(String(64), nullable=False, unique=True, index=True)
    automation_id = Column(Integer, ForeignKey("automations.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    status = Column(String(32), default="queued", nullable=False)
    counts_json = Column(Text, default="{}", nullable=False)
    result_json = Column(Text, default="{}", nullable=False)
    trigger = Column(String(32), default="manual", nullable=False)
    attempt_count = Column(Integer, default=1, nullable=False)
    error = Column(Text, nullable=True)
    cost_micros = Column(Integer, default=0, nullable=False)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class CareerJobMatch(Base):
    __tablename__ = "career_job_matches"
    __table_args__ = (UniqueConstraint("run_id", "job_id", name="uq_job_match_run_job"),)

    id = Column(Integer, primary_key=True)
    public_id = Column(String(64), nullable=False, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    automation_id = Column(Integer, ForeignKey("automations.id"), nullable=False, index=True)
    run_id = Column(Integer, ForeignKey("automation_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    job_id = Column(Integer, ForeignKey("career_jobs.id"), nullable=False, index=True)
    match_score = Column(Integer, default=0, nullable=False)
    match_reason = Column(Text, default="", nullable=False)
    is_new = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True)
    public_id = Column(String(64), nullable=False, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    kind = Column(String(50), default="info", nullable=False)
    title = Column(String(255), nullable=False)
    message = Column(Text, default="", nullable=False)
    href = Column(Text, nullable=True)
    read_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class Integration(Base):
    __tablename__ = "integrations"
    __table_args__ = (UniqueConstraint("user_id", "provider", name="uq_integration_user_provider"),)

    id = Column(Integer, primary_key=True)
    public_id = Column(String(64), nullable=False, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    provider = Column(String(64), nullable=False)
    state = Column(String(32), default="disconnected", nullable=False)
    scopes = Column(Text, default="[]", nullable=False)
    external_account = Column(String(255), nullable=True)
    config_json = Column(Text, default="{}", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class AIConversation(Base):
    __tablename__ = "ai_conversations"

    id = Column(Integer, primary_key=True)
    public_id = Column(String(64), nullable=False, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(255), default="New conversation", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class AIMessage(Base):
    __tablename__ = "ai_messages"

    id = Column(Integer, primary_key=True)
    public_id = Column(String(64), nullable=False, unique=True, index=True)
    conversation_id = Column(Integer, ForeignKey("ai_conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    citations_json = Column(Text, default="[]", nullable=False)
    token_count = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class DailyApiUsage(Base):
    """Persistent per-user usage counter for server-funded external APIs."""

    __tablename__ = "daily_api_usage"
    __table_args__ = (UniqueConstraint("user_id", "usage_date", name="uq_daily_api_usage_user_date"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    usage_date = Column(String(10), nullable=False, index=True)
    units = Column(Integer, default=0, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class GenerationJob(Base):
    """Durable, idempotent state for a complete resume generation run."""

    __tablename__ = "generation_jobs"
    __table_args__ = (UniqueConstraint("user_id", "idempotency_key", name="uq_generation_job_user_key"),)

    id = Column(Integer, primary_key=True)
    public_id = Column(String(64), nullable=False, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    idempotency_key = Column(String(128), nullable=False)
    status = Column(String(32), default="queued", nullable=False, index=True)
    step = Column(String(32), default="queued", nullable=False)
    progress = Column(Integer, default=0, nullable=False)
    request_json = Column(Text, default="{}", nullable=False)
    result_json = Column(Text, default="{}", nullable=False)
    error = Column(Text, nullable=True)
    history_record_id = Column(Integer, ForeignKey("history_records.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


def _sync_sequences():
    """
    Sync PostgreSQL serial sequences with actual max IDs.
    Prevents duplicate key errors when rows were inserted without the sequence.
    """
    if IS_SQLITE:
        return
    tables = ["users", "profiles", "history_records"]
    with engine.connect() as conn:
        for table in tables:
            seq_name = f"{table}_id_seq"
            conn.execute(text(
                f"SELECT setval('{seq_name}', COALESCE((SELECT MAX(id) FROM {table}), 0) + 1, false)"
            ))
        conn.commit()


def init_db():
    """Create all tables if they don't exist."""
    if IS_SQLITE:
        sqlite_path = Path(DB_URL.replace("sqlite:///", "", 1))
        sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    _ensure_compatible_columns()
    _sync_sequences()


def _ensure_compatible_columns():
    """Apply small additive migrations for deployments without Alembic."""
    additions = {
        "career_jobs": {
            "source_key": "VARCHAR(64)",
            "source": "VARCHAR(64) DEFAULT 'manual' NOT NULL",
            "location": "VARCHAR(255) DEFAULT '' NOT NULL",
            "source_payload": "TEXT DEFAULT '{}' NOT NULL",
        },
        "career_applications": {
            "approval_status": "VARCHAR(32) DEFAULT 'pending' NOT NULL",
            "match_score": "INTEGER DEFAULT 0 NOT NULL",
            "automation_id": "INTEGER",
        },
        "automations": {
            "max_retries": "INTEGER DEFAULT 2 NOT NULL",
            "next_run_at": "TIMESTAMP",
            "last_run_at": "TIMESTAMP",
        },
        "automation_runs": {
            "result_json": "TEXT DEFAULT '{}' NOT NULL",
            "trigger": "VARCHAR(32) DEFAULT 'manual' NOT NULL",
            "attempt_count": "INTEGER DEFAULT 1 NOT NULL",
        },
    }
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table, desired in additions.items():
            existing = {column["name"] for column in inspector.get_columns(table)}
            for name, sql_type in desired.items():
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {sql_type}"))
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_career_jobs_user_source_key "
            "ON career_jobs (user_id, source_key)"
        ))


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: yields a DB session and closes it after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
