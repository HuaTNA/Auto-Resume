"""Authenticated Personal AI Workspace APIs.

The routes in this module keep the existing Career API intact while providing
server-backed storage for the cross-workspace modules introduced by the new UI.
"""

import json
import os
from datetime import datetime
from typing import Any, Literal
from uuid import uuid4

import anthropic
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from api.database import (
    AIConversation,
    AIMessage,
    Automation,
    AutomationRun,
    CareerApplication,
    CareerJob,
    Document,
    DocumentVersion,
    HistoryRecord,
    Integration,
    InterviewNote,
    KnowledgeItem,
    Notification,
    Profile,
    User,
    WorkspaceActivity,
    WorkspaceProject,
    WorkspaceTask,
    get_db,
)
from api.dependencies import get_current_user
from api.workflows.job_search import execute_automation, generate_application_materials, run_to_dict
from api.workflows.runner import run_due_automations
from api.workflows.scheduling import next_run_at


router = APIRouter(prefix="/api", tags=["workspace"])


def _uuid() -> str:
    return str(uuid4())


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _json_load(value: str | None, fallback: Any) -> Any:
    try:
        return json.loads(value or "")
    except (TypeError, json.JSONDecodeError):
        return fallback


def _json_dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _model_dump(value: BaseModel, *, exclude_unset: bool = False) -> dict:
    if hasattr(value, "model_dump"):
        return value.model_dump(exclude_unset=exclude_unset)
    return value.dict(exclude_unset=exclude_unset)


def _field_names(model: type[BaseModel]):
    return getattr(model, "model_fields", getattr(model, "__fields__", {})).keys()


def _reject_credentials(value: Any) -> None:
    forbidden = ("token", "secret", "password", "api_key", "apikey", "credential")
    if isinstance(value, dict):
        for key, item in value.items():
            if any(part in str(key).lower() for part in forbidden):
                raise HTTPException(400, "Store only a credential reference, never raw credentials")
            _reject_credentials(item)
    elif isinstance(value, list):
        for item in value:
            _reject_credentials(item)


def _bounded_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(parsed, maximum))


def _project_dict(row: WorkspaceProject) -> dict:
    return {
        "id": row.public_id, "user_id": row.user_id, "module": "projects",
        "title": row.title, "summary": row.summary, "status": row.status,
        "progress": row.progress, "next_action": row.next_action,
        "due_date": row.due_date, "tags": _json_load(row.tags, []),
        "created_at": _iso(row.created_at), "updated_at": _iso(row.updated_at),
    }


def _task_dict(row: WorkspaceTask) -> dict:
    return {
        "id": row.public_id, "user_id": row.user_id, "module": "tasks",
        "title": row.title, "status": row.status, "priority": row.priority,
        "due_date": row.due_date, "tags": _json_load(row.tags, []),
        "project_id": row.project_id, "related_job_id": row.related_job_id,
        "created_at": _iso(row.created_at), "updated_at": _iso(row.updated_at),
    }


def _knowledge_dict(row: KnowledgeItem) -> dict:
    return {
        "id": row.public_id, "user_id": row.user_id, "module": "knowledge",
        "kind": row.kind, "title": row.title, "content": row.content,
        "url": row.url, "tags": _json_load(row.tags, []),
        "created_at": _iso(row.created_at), "updated_at": _iso(row.updated_at),
    }


def _activity_dict(row: WorkspaceActivity) -> dict:
    return {
        "id": row.public_id, "user_id": row.user_id, "module": row.module,
        "action": row.action, "entity_type": row.entity_type,
        "entity_id": row.entity_id, "title": row.title,
        "created_at": _iso(row.created_at), "updated_at": _iso(row.updated_at),
    }


def _add_activity(db: Session, user_id: int, module: str, action: str,
                  entity_type: str, entity_id: str, title: str) -> None:
    db.add(WorkspaceActivity(
        public_id=_uuid(), user_id=user_id, module=module, action=action,
        entity_type=entity_type, entity_id=entity_id, title=title[:255],
    ))


class ProjectCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    summary: str = Field(default="", max_length=20000)
    status: Literal["planned", "active", "blocked", "completed"] = "active"
    progress: int = Field(default=0, ge=0, le=100)
    next_action: str = Field(default="", max_length=10000)
    due_date: str | None = Field(default=None, max_length=32)
    tags: list[str] = Field(default_factory=list, max_length=50)


class ProjectUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    summary: str | None = Field(default=None, max_length=20000)
    status: Literal["planned", "active", "blocked", "completed"] | None = None
    progress: int | None = Field(default=None, ge=0, le=100)
    next_action: str | None = Field(default=None, max_length=10000)
    due_date: str | None = Field(default=None, max_length=32)
    tags: list[str] | None = Field(default=None, max_length=50)


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    priority: Literal["low", "medium", "high"] = "medium"
    due_date: str | None = Field(default=None, max_length=32)
    tags: list[str] = Field(default_factory=list, max_length=50)
    project_id: str | None = Field(default=None, max_length=64)
    related_job_id: int | None = None


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    status: Literal["todo", "done"] | None = None
    priority: Literal["low", "medium", "high"] | None = None
    due_date: str | None = Field(default=None, max_length=32)
    tags: list[str] | None = Field(default=None, max_length=50)
    project_id: str | None = Field(default=None, max_length=64)


class KnowledgeCreate(BaseModel):
    kind: Literal["note", "research", "link"] = "note"
    title: str = Field(min_length=1, max_length=255)
    content: str = Field(default="", max_length=100000)
    url: str | None = Field(default=None, max_length=4000)
    tags: list[str] = Field(default_factory=list, max_length=50)


class KnowledgeUpdate(BaseModel):
    kind: Literal["note", "research", "link"] | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    content: str | None = Field(default=None, max_length=100000)
    url: str | None = Field(default=None, max_length=4000)
    tags: list[str] | None = Field(default=None, max_length=50)


@router.get("/workspace")
def get_workspace(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    projects = db.query(WorkspaceProject).filter(WorkspaceProject.user_id == current_user.id).order_by(WorkspaceProject.updated_at.desc()).all()
    tasks = db.query(WorkspaceTask).filter(WorkspaceTask.user_id == current_user.id).order_by(WorkspaceTask.updated_at.desc()).all()
    knowledge = db.query(KnowledgeItem).filter(KnowledgeItem.user_id == current_user.id).order_by(KnowledgeItem.updated_at.desc()).all()
    activities = db.query(WorkspaceActivity).filter(WorkspaceActivity.user_id == current_user.id).order_by(WorkspaceActivity.id.desc()).limit(50).all()
    return {"version": 1, "projects": list(map(_project_dict, projects)), "tasks": list(map(_task_dict, tasks)), "knowledge": list(map(_knowledge_dict, knowledge)), "activities": list(map(_activity_dict, activities))}


@router.post("/workspace/projects", status_code=201)
def create_project(data: ProjectCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = WorkspaceProject(public_id=_uuid(), user_id=current_user.id, title=data.title.strip(), summary=data.summary.strip(), status=data.status, progress=data.progress, next_action=data.next_action.strip(), due_date=data.due_date or None, tags=_json_dump(data.tags))
    db.add(row); _add_activity(db, current_user.id, "projects", "created", "project", row.public_id, row.title); db.commit(); db.refresh(row)
    return {"project": _project_dict(row)}


@router.patch("/workspace/projects/{public_id}")
def update_project(public_id: str, data: ProjectUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.query(WorkspaceProject).filter(WorkspaceProject.user_id == current_user.id, WorkspaceProject.public_id == public_id).first()
    if not row: raise HTTPException(404, "Project not found")
    patch = _model_dump(data, exclude_unset=True)
    for key, value in patch.items(): setattr(row, key, _json_dump(value) if key == "tags" else value)
    row.updated_at = datetime.utcnow(); _add_activity(db, current_user.id, "projects", "completed" if row.status == "completed" else "updated", "project", row.public_id, row.title); db.commit(); db.refresh(row)
    return {"project": _project_dict(row)}


@router.delete("/workspace/projects/{public_id}")
def delete_project(public_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.query(WorkspaceProject).filter(WorkspaceProject.user_id == current_user.id, WorkspaceProject.public_id == public_id).first()
    if not row: raise HTTPException(404, "Project not found")
    db.query(WorkspaceTask).filter(WorkspaceTask.user_id == current_user.id, WorkspaceTask.project_id == public_id).update({WorkspaceTask.project_id: None})
    db.delete(row); _add_activity(db, current_user.id, "projects", "updated", "project", public_id, f"Deleted {row.title}"); db.commit()
    return {"ok": True}


@router.post("/workspace/tasks", status_code=201)
def create_task(data: TaskCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if data.project_id and not db.query(WorkspaceProject).filter(WorkspaceProject.user_id == current_user.id, WorkspaceProject.public_id == data.project_id).first(): raise HTTPException(400, "Project not found")
    row = WorkspaceTask(public_id=_uuid(), user_id=current_user.id, title=data.title.strip(), status="todo", priority=data.priority, due_date=data.due_date or None, tags=_json_dump(data.tags), project_id=data.project_id or None, related_job_id=data.related_job_id)
    db.add(row); _add_activity(db, current_user.id, "tasks", "created", "task", row.public_id, row.title); db.commit(); db.refresh(row)
    return {"task": _task_dict(row)}


@router.patch("/workspace/tasks/{public_id}")
def update_task(public_id: str, data: TaskUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.query(WorkspaceTask).filter(WorkspaceTask.user_id == current_user.id, WorkspaceTask.public_id == public_id).first()
    if not row: raise HTTPException(404, "Task not found")
    patch = _model_dump(data, exclude_unset=True)
    if patch.get("project_id") and not db.query(WorkspaceProject).filter(WorkspaceProject.user_id == current_user.id, WorkspaceProject.public_id == patch["project_id"]).first(): raise HTTPException(400, "Project not found")
    for key, value in patch.items(): setattr(row, key, _json_dump(value) if key == "tags" else value)
    row.updated_at = datetime.utcnow(); _add_activity(db, current_user.id, "tasks", "completed" if row.status == "done" else "updated", "task", row.public_id, row.title); db.commit(); db.refresh(row)
    return {"task": _task_dict(row)}


@router.delete("/workspace/tasks/{public_id}")
def delete_task(public_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.query(WorkspaceTask).filter(WorkspaceTask.user_id == current_user.id, WorkspaceTask.public_id == public_id).first()
    if not row: raise HTTPException(404, "Task not found")
    db.delete(row); _add_activity(db, current_user.id, "tasks", "updated", "task", public_id, f"Deleted {row.title}"); db.commit(); return {"ok": True}


@router.post("/workspace/knowledge", status_code=201)
def create_knowledge(data: KnowledgeCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = KnowledgeItem(public_id=_uuid(), user_id=current_user.id, kind=data.kind, title=data.title.strip(), content=data.content.strip(), url=data.url or None, tags=_json_dump(data.tags))
    db.add(row); _add_activity(db, current_user.id, "knowledge", "created", "knowledge", row.public_id, row.title); db.commit(); db.refresh(row)
    return {"item": _knowledge_dict(row)}


@router.patch("/workspace/knowledge/{public_id}")
def update_knowledge(public_id: str, data: KnowledgeUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.query(KnowledgeItem).filter(KnowledgeItem.user_id == current_user.id, KnowledgeItem.public_id == public_id).first()
    if not row: raise HTTPException(404, "Knowledge item not found")
    for key, value in _model_dump(data, exclude_unset=True).items(): setattr(row, key, _json_dump(value) if key == "tags" else value)
    row.updated_at = datetime.utcnow(); _add_activity(db, current_user.id, "knowledge", "updated", "knowledge", row.public_id, row.title); db.commit(); db.refresh(row)
    return {"item": _knowledge_dict(row)}


@router.delete("/workspace/knowledge/{public_id}")
def delete_knowledge(public_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.query(KnowledgeItem).filter(KnowledgeItem.user_id == current_user.id, KnowledgeItem.public_id == public_id).first()
    if not row: raise HTTPException(404, "Knowledge item not found")
    db.delete(row); _add_activity(db, current_user.id, "knowledge", "updated", "knowledge", public_id, f"Deleted {row.title}"); db.commit(); return {"ok": True}


class WorkspaceImport(BaseModel):
    projects: list[dict] = Field(default_factory=list, max_length=1000)
    tasks: list[dict] = Field(default_factory=list, max_length=5000)
    knowledge: list[dict] = Field(default_factory=list, max_length=5000)


@router.post("/workspace/import")
def import_workspace(data: WorkspaceImport, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    counts = {"projects": 0, "tasks": 0, "knowledge": 0}
    for item in data.projects:
        public_id = str(item.get("id") or _uuid())[:64]
        if db.query(WorkspaceProject).filter(WorkspaceProject.user_id == current_user.id, WorkspaceProject.public_id == public_id).first(): continue
        parsed = ProjectCreate(**{k: item[k] for k in _field_names(ProjectCreate) if k in item})
        db.add(WorkspaceProject(public_id=public_id, user_id=current_user.id, title=parsed.title, summary=parsed.summary, status=parsed.status, progress=parsed.progress, next_action=parsed.next_action, due_date=parsed.due_date, tags=_json_dump(parsed.tags))); counts["projects"] += 1
    db.flush()
    for item in data.tasks:
        public_id = str(item.get("id") or _uuid())[:64]
        if db.query(WorkspaceTask).filter(WorkspaceTask.user_id == current_user.id, WorkspaceTask.public_id == public_id).first(): continue
        parsed = TaskCreate(**{k: item[k] for k in _field_names(TaskCreate) if k in item})
        db.add(WorkspaceTask(public_id=public_id, user_id=current_user.id, title=parsed.title, status=item.get("status") if item.get("status") in ("todo", "done") else "todo", priority=parsed.priority, due_date=parsed.due_date, tags=_json_dump(parsed.tags), project_id=parsed.project_id, related_job_id=parsed.related_job_id)); counts["tasks"] += 1
    for item in data.knowledge:
        public_id = str(item.get("id") or _uuid())[:64]
        if db.query(KnowledgeItem).filter(KnowledgeItem.user_id == current_user.id, KnowledgeItem.public_id == public_id).first(): continue
        parsed = KnowledgeCreate(**{k: item[k] for k in _field_names(KnowledgeCreate) if k in item})
        db.add(KnowledgeItem(public_id=public_id, user_id=current_user.id, kind=parsed.kind, title=parsed.title, content=parsed.content, url=parsed.url, tags=_json_dump(parsed.tags))); counts["knowledge"] += 1
    db.commit(); return {"ok": True, "imported": counts}


def _document_dict(row: Document, version_count: int = 0) -> dict:
    return {"id": row.public_id, "title": row.title, "kind": row.kind, "owner_module": row.owner_module, "status": row.status, "source_record_id": row.source_record_id, "version_count": version_count, "created_at": _iso(row.created_at), "updated_at": _iso(row.updated_at)}


def _ensure_history_documents(db: Session, user: User) -> None:
    records = db.query(HistoryRecord).filter(HistoryRecord.user_id == user.id).all()
    changed = False
    for record in records:
        for kind, content in (("resume", record.resume_tex), ("cover_letter", record.cover_letter)):
            if not content: continue
            document = db.query(Document).filter(Document.user_id == user.id, Document.source_record_id == record.id, Document.kind == kind).first()
            if document: continue
            document = Document(public_id=_uuid(), user_id=user.id, title=f"{record.job_title} · {record.company}", kind=kind, owner_module="career", source_record_id=record.id)
            db.add(document); db.flush()
            db.add(DocumentVersion(public_id=_uuid(), document_id=document.id, user_id=user.id, version_number=1, content=content, metadata_json=_json_dump({"template": record.template, "ats_scores": _json_load(record.ats_scores, {})})))
            changed = True
    if changed: db.commit()


class DocumentCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    kind: str = Field(default="document", max_length=50)
    owner_module: str = Field(default="documents", max_length=32)
    content: str = Field(default="", max_length=500000)
    metadata: dict = Field(default_factory=dict)


@router.get("/documents")
def list_documents(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _ensure_history_documents(db, current_user)
    rows = db.query(Document).filter(Document.user_id == current_user.id).order_by(Document.updated_at.desc()).all()
    return {"documents": [_document_dict(row, db.query(DocumentVersion).filter(DocumentVersion.document_id == row.id, DocumentVersion.user_id == current_user.id).count()) for row in rows]}


@router.post("/documents", status_code=201)
def create_document(data: DocumentCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = Document(public_id=_uuid(), user_id=current_user.id, title=data.title.strip(), kind=data.kind, owner_module=data.owner_module)
    db.add(row); db.flush(); db.add(DocumentVersion(public_id=_uuid(), document_id=row.id, user_id=current_user.id, version_number=1, content=data.content, metadata_json=_json_dump(data.metadata))); _add_activity(db, current_user.id, "documents", "created", "document", row.public_id, row.title); db.commit(); db.refresh(row)
    return {"document": _document_dict(row, 1)}


@router.get("/documents/{public_id}")
def get_document(public_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.query(Document).filter(Document.user_id == current_user.id, Document.public_id == public_id).first()
    if not row: raise HTTPException(404, "Document not found")
    versions = db.query(DocumentVersion).filter(DocumentVersion.user_id == current_user.id, DocumentVersion.document_id == row.id).order_by(DocumentVersion.version_number.desc()).all()
    return {"document": _document_dict(row, len(versions)), "versions": [{"id": item.public_id, "version_number": item.version_number, "content": item.content, "storage_path": item.storage_path, "metadata": _json_load(item.metadata_json, {}), "created_at": _iso(item.created_at)} for item in versions]}


class DocumentVersionCreate(BaseModel):
    content: str = Field(max_length=500000)
    storage_path: str | None = Field(default=None, max_length=4000)
    metadata: dict = Field(default_factory=dict)


@router.post("/documents/{public_id}/versions", status_code=201)
def create_document_version(public_id: str, data: DocumentVersionCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.query(Document).filter(Document.user_id == current_user.id, Document.public_id == public_id).first()
    if not row: raise HTTPException(404, "Document not found")
    latest = db.query(DocumentVersion).filter(DocumentVersion.document_id == row.id).order_by(DocumentVersion.version_number.desc()).first()
    version = DocumentVersion(public_id=_uuid(), document_id=row.id, user_id=current_user.id, version_number=(latest.version_number if latest else 0) + 1, content=data.content, storage_path=data.storage_path, metadata_json=_json_dump(data.metadata))
    db.add(version); row.updated_at = datetime.utcnow(); _add_activity(db, current_user.id, "documents", "updated", "document", row.public_id, row.title); db.commit(); db.refresh(version)
    return {"version": {"id": version.public_id, "version_number": version.version_number, "created_at": _iso(version.created_at)}}


@router.delete("/documents/{public_id}")
def delete_document(public_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.query(Document).filter(Document.user_id == current_user.id, Document.public_id == public_id).first()
    if not row: raise HTTPException(404, "Document not found")
    db.query(DocumentVersion).filter(DocumentVersion.document_id == row.id, DocumentVersion.user_id == current_user.id).delete(); db.delete(row); db.commit(); return {"ok": True}


class InterviewNoteCreate(BaseModel):
    application_record_id: int
    kind: Literal["note", "star", "question", "debrief"] = "note"
    title: str = Field(min_length=1, max_length=255)
    content: str = Field(default="", max_length=100000)


@router.get("/interviews")
def list_interviews(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    applications = db.query(HistoryRecord).filter(HistoryRecord.user_id == current_user.id, HistoryRecord.status == "interview").order_by(HistoryRecord.id.desc()).all()
    notes = db.query(InterviewNote).filter(InterviewNote.user_id == current_user.id).order_by(InterviewNote.updated_at.desc()).all()
    return {"applications": [record.to_dict() | {"resume_tex": "", "cover_letter": ""} for record in applications], "notes": [{"id": row.public_id, "application_record_id": row.application_record_id, "kind": row.kind, "title": row.title, "content": row.content, "created_at": _iso(row.created_at), "updated_at": _iso(row.updated_at)} for row in notes]}


@router.post("/interviews/notes", status_code=201)
def create_interview_note(data: InterviewNoteCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    application = db.query(HistoryRecord).filter(HistoryRecord.user_id == current_user.id, HistoryRecord.id == data.application_record_id).first()
    if not application: raise HTTPException(404, "Application not found")
    row = InterviewNote(public_id=_uuid(), user_id=current_user.id, application_record_id=application.id, kind=data.kind, title=data.title.strip(), content=data.content)
    db.add(row); _add_activity(db, current_user.id, "career", "created", "knowledge", row.public_id, row.title); db.commit(); db.refresh(row)
    return {"note": {"id": row.public_id, "application_record_id": row.application_record_id, "kind": row.kind, "title": row.title, "content": row.content, "created_at": _iso(row.created_at), "updated_at": _iso(row.updated_at)}}


class AutomationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    kind: Literal["workspace_snapshot", "job_search"] = "workspace_snapshot"
    schedule: str | None = Field(default=None, max_length=255)
    enabled: bool = True
    max_retries: int = Field(default=2, ge=0, le=3)
    config: dict = Field(default_factory=dict)


def _automation_dict(row: Automation) -> dict:
    return {"id": row.public_id, "name": row.name, "kind": row.kind, "schedule": row.schedule, "enabled": row.enabled, "max_retries": row.max_retries, "next_run_at": _iso(row.next_run_at), "last_run_at": _iso(row.last_run_at), "config": _json_load(row.config_json, {}), "created_at": _iso(row.created_at), "updated_at": _iso(row.updated_at)}


@router.get("/automations")
def list_automations(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    automations = db.query(Automation).filter(Automation.user_id == current_user.id).order_by(Automation.updated_at.desc()).all()
    runs = db.query(AutomationRun).filter(AutomationRun.user_id == current_user.id).order_by(AutomationRun.id.desc()).limit(50).all()
    by_id = {row.id: row.public_id for row in automations}
    return {"automations": list(map(_automation_dict, automations)), "runs": [run_to_dict(row, by_id.get(row.automation_id)) for row in runs]}


@router.post("/automations", status_code=201)
def create_automation(data: AutomationCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    timezone_name = str(data.config.get("timezone") or "America/Toronto")
    row = Automation(public_id=_uuid(), user_id=current_user.id, name=data.name.strip(), kind=data.kind, schedule=data.schedule or "manual", enabled=data.enabled, max_retries=data.max_retries, next_run_at=next_run_at(data.schedule, timezone_name=timezone_name), config_json=_json_dump(data.config))
    db.add(row); db.commit(); db.refresh(row); return {"automation": _automation_dict(row)}


class AutomationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    schedule: str | None = Field(default=None, max_length=255)
    enabled: bool | None = None
    max_retries: int | None = Field(default=None, ge=0, le=3)
    config: dict | None = None


@router.patch("/automations/{public_id}")
def update_automation(public_id: str, data: AutomationUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.query(Automation).filter(Automation.user_id == current_user.id, Automation.public_id == public_id).first()
    if not row: raise HTTPException(404, "Automation not found")
    for key, value in _model_dump(data, exclude_unset=True).items(): setattr(row, "config_json" if key == "config" else key, _json_dump(value) if key == "config" else value)
    config = _json_load(row.config_json, {})
    row.next_run_at = next_run_at(row.schedule, timezone_name=str(config.get("timezone") or "America/Toronto")) if row.enabled else None
    row.updated_at = datetime.utcnow(); db.commit(); db.refresh(row); return {"automation": _automation_dict(row)}


@router.post("/automations/{public_id}/runs", status_code=201)
def run_automation(public_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    automation = db.query(Automation).filter(Automation.user_id == current_user.id, Automation.public_id == public_id).first()
    if not automation: raise HTTPException(404, "Automation not found")
    if not automation.enabled: raise HTTPException(409, "Automation is disabled")
    run = execute_automation(db, automation, current_user, trigger="manual")
    return {"run": run_to_dict(run, automation.public_id)}


@router.post("/career/history/{record_id}/generate-materials")
def generate_suggested_materials(record_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    application = db.query(CareerApplication).filter(CareerApplication.user_id == current_user.id, CareerApplication.history_record_id == record_id).first()
    if not application: raise HTTPException(404, "Application suggestion not found")
    try:
        history = generate_application_materials(db, current_user, application)
    except Exception as exc:
        db.rollback(); raise HTTPException(502, f"Material generation failed: {type(exc).__name__}: {exc}") from exc
    return {"ok": True, "record": history.to_dict()}


@router.post("/career/history/{record_id}/approve")
def approve_application(record_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    application = db.query(CareerApplication).filter(CareerApplication.user_id == current_user.id, CareerApplication.history_record_id == record_id).first()
    if not application: raise HTTPException(404, "Application not found")
    history = db.query(HistoryRecord).filter(HistoryRecord.user_id == current_user.id, HistoryRecord.id == record_id).first()
    if not history or not history.resume_tex: raise HTTPException(409, "Generate and review materials before approval")
    application.approval_status = "approved"
    application.updated_at = datetime.utcnow()
    db.add(Notification(public_id=_uuid(), user_id=current_user.id, kind="approval", title=f"Approved: {history.job_title}", message="Materials are approved. External submission remains manual.", href="/career/applications"))
    db.commit(); return {"ok": True, "approval_status": "approved"}


@router.get("/notifications")
def list_notifications(unread_only: bool = Query(False), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(Notification).filter(Notification.user_id == current_user.id)
    if unread_only: query = query.filter(Notification.read_at.is_(None))
    rows = query.order_by(Notification.id.desc()).limit(50).all()
    return {"notifications": [{"id": row.public_id, "kind": row.kind, "title": row.title, "message": row.message, "href": row.href, "read_at": _iso(row.read_at), "created_at": _iso(row.created_at)} for row in rows]}


@router.patch("/notifications/{public_id}/read")
def mark_notification_read(public_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.query(Notification).filter(Notification.user_id == current_user.id, Notification.public_id == public_id).first()
    if not row: raise HTTPException(404, "Notification not found")
    row.read_at = datetime.utcnow(); db.commit(); return {"ok": True}


@router.post("/internal/automations/run-due")
def run_due(x_cron_secret: str | None = Header(default=None), limit: int = Query(10, ge=1, le=50), db: Session = Depends(get_db)):
    expected = os.environ.get("CRON_SECRET", "").strip()
    if not expected: raise HTTPException(503, "CRON_SECRET is not configured")
    import secrets
    if not x_cron_secret or not secrets.compare_digest(x_cron_secret, expected): raise HTTPException(401, "Invalid cron secret")
    runs = run_due_automations(db, limit)
    return {"ok": True, "processed": len(runs), "runs": runs}


class IntegrationUpsert(BaseModel):
    state: Literal["disconnected", "connected", "error"] = "connected"
    scopes: list[str] = Field(default_factory=list, max_length=100)
    external_account: str | None = Field(default=None, max_length=255)
    config: dict = Field(default_factory=dict)


@router.get("/integrations")
def list_integrations(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(Integration).filter(Integration.user_id == current_user.id).order_by(Integration.provider).all()
    return {"integrations": [{"id": row.public_id, "provider": row.provider, "state": row.state, "scopes": _json_load(row.scopes, []), "external_account": row.external_account, "config": _json_load(row.config_json, {}), "created_at": _iso(row.created_at), "updated_at": _iso(row.updated_at)} for row in rows]}


@router.put("/integrations/{provider}")
def upsert_integration(provider: str, data: IntegrationUpsert, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not provider.replace("-", "").replace("_", "").isalnum(): raise HTTPException(400, "Invalid provider")
    _reject_credentials(data.config)
    row = db.query(Integration).filter(Integration.user_id == current_user.id, Integration.provider == provider).first()
    if not row: row = Integration(public_id=_uuid(), user_id=current_user.id, provider=provider); db.add(row)
    row.state, row.scopes, row.external_account, row.config_json, row.updated_at = data.state, _json_dump(data.scopes), data.external_account, _json_dump(data.config), datetime.utcnow()
    db.commit(); db.refresh(row); return {"integration": {"id": row.public_id, "provider": row.provider, "state": row.state, "scopes": data.scopes, "external_account": row.external_account, "config": data.config, "updated_at": _iso(row.updated_at)}}


@router.delete("/integrations/{provider}")
def disconnect_integration(provider: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.query(Integration).filter(Integration.user_id == current_user.id, Integration.provider == provider).first()
    if not row: raise HTTPException(404, "Integration not found")
    db.delete(row); db.commit(); return {"ok": True}


class ConversationCreate(BaseModel):
    title: str = Field(default="New conversation", min_length=1, max_length=255)


@router.get("/copilot/conversations")
def list_conversations(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(AIConversation).filter(AIConversation.user_id == current_user.id).order_by(AIConversation.updated_at.desc()).all()
    return {"conversations": [{"id": row.public_id, "title": row.title, "created_at": _iso(row.created_at), "updated_at": _iso(row.updated_at)} for row in rows]}


@router.post("/copilot/conversations", status_code=201)
def create_conversation(data: ConversationCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = AIConversation(public_id=_uuid(), user_id=current_user.id, title=data.title.strip()); db.add(row); db.commit(); db.refresh(row)
    return {"conversation": {"id": row.public_id, "title": row.title, "created_at": _iso(row.created_at), "updated_at": _iso(row.updated_at)}}


@router.get("/copilot/conversations/{public_id}")
def get_conversation(public_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.query(AIConversation).filter(AIConversation.user_id == current_user.id, AIConversation.public_id == public_id).first()
    if not row: raise HTTPException(404, "Conversation not found")
    messages = db.query(AIMessage).filter(AIMessage.user_id == current_user.id, AIMessage.conversation_id == row.id).order_by(AIMessage.id).all()
    return {"conversation": {"id": row.public_id, "title": row.title}, "messages": [{"id": item.public_id, "role": item.role, "content": item.content, "citations": _json_load(item.citations_json, []), "created_at": _iso(item.created_at)} for item in messages]}


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=30000)


def _copilot_context(db: Session, user: User) -> tuple[str, list[dict]]:
    projects = db.query(WorkspaceProject).filter(WorkspaceProject.user_id == user.id).order_by(WorkspaceProject.updated_at.desc()).limit(20).all()
    tasks = db.query(WorkspaceTask).filter(WorkspaceTask.user_id == user.id, WorkspaceTask.status == "todo").order_by(WorkspaceTask.updated_at.desc()).limit(30).all()
    knowledge = db.query(KnowledgeItem).filter(KnowledgeItem.user_id == user.id).order_by(KnowledgeItem.updated_at.desc()).limit(20).all()
    applications = db.query(HistoryRecord).filter(HistoryRecord.user_id == user.id).order_by(HistoryRecord.id.desc()).limit(10).all()
    citations = ([{"type": "project", "id": row.public_id, "title": row.title} for row in projects] + [{"type": "task", "id": row.public_id, "title": row.title} for row in tasks] + [{"type": "knowledge", "id": row.public_id, "title": row.title} for row in knowledge] + [{"type": "application", "id": row.id, "title": f"{row.job_title} · {row.company}"} for row in applications])
    context = {"projects": [_project_dict(row) for row in projects], "open_tasks": [_task_dict(row) for row in tasks], "knowledge": [_knowledge_dict(row) for row in knowledge], "applications": [{"id": row.id, "job_title": row.job_title, "company": row.company, "status": row.status, "ats_scores": _json_load(row.ats_scores, {})} for row in applications]}
    return _json_dump(context), citations


@router.post("/copilot/conversations/{public_id}/messages", status_code=201)
def send_message(public_id: str, data: MessageCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    conversation = db.query(AIConversation).filter(AIConversation.user_id == current_user.id, AIConversation.public_id == public_id).first()
    if not conversation: raise HTTPException(404, "Conversation not found")
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key: raise HTTPException(503, "AI service is not configured")
    user_message = AIMessage(public_id=_uuid(), conversation_id=conversation.id, user_id=current_user.id, role="user", content=data.content.strip())
    db.add(user_message); db.flush()
    previous = db.query(AIMessage).filter(AIMessage.user_id == current_user.id, AIMessage.conversation_id == conversation.id, AIMessage.id != user_message.id).order_by(AIMessage.id.desc()).limit(10).all()[::-1]
    context, citations = _copilot_context(db, current_user)
    client = anthropic.Anthropic(api_key=api_key)
    try:
        response = client.messages.create(model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-20250514"), max_tokens=1200, system=f"You are Hua, a concise personal workspace copilot. Use only the authorized workspace context supplied. State uncertainty and never claim an action was taken.\n\nAUTHORIZED WORKSPACE CONTEXT:\n{context}", messages=[{"role": item.role, "content": item.content} for item in previous if item.role in ("user", "assistant")] + [{"role": "user", "content": data.content.strip()}])
        answer = response.content[0].text.strip()
        token_count = getattr(getattr(response, "usage", None), "output_tokens", 0) or 0
    except Exception as exc:
        db.rollback(); raise HTTPException(502, f"AI service unavailable: {type(exc).__name__}") from exc
    assistant = AIMessage(public_id=_uuid(), conversation_id=conversation.id, user_id=current_user.id, role="assistant", content=answer, citations_json=_json_dump(citations), token_count=token_count)
    db.add(assistant); conversation.updated_at = datetime.utcnow(); db.commit(); db.refresh(user_message); db.refresh(assistant)
    return {"user_message": {"id": user_message.public_id, "role": "user", "content": user_message.content, "created_at": _iso(user_message.created_at)}, "assistant_message": {"id": assistant.public_id, "role": "assistant", "content": assistant.content, "citations": citations, "created_at": _iso(assistant.created_at)}}
