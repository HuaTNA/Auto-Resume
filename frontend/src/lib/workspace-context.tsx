"use client";

import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  EMPTY_WORKSPACE,
  KnowledgeItem,
  KnowledgeKind,
  ProjectStatus,
  TaskPriority,
  WorkspaceActivity,
  WorkspaceData,
  WorkspaceProject,
  WorkspaceTask,
} from "@/lib/workspace-types";

interface ProjectInput {
  title: string;
  summary?: string;
  status?: ProjectStatus;
  next_action?: string;
  due_date?: string;
  tags?: string[];
}

interface TaskInput {
  title: string;
  priority?: TaskPriority;
  due_date?: string;
  tags?: string[];
  project_id?: string;
  related_job_id?: number;
}

interface KnowledgeInput {
  kind?: KnowledgeKind;
  title: string;
  content?: string;
  url?: string;
  tags?: string[];
}

interface WorkspaceContextValue extends WorkspaceData {
  isLoading: boolean;
  createProject: (input: ProjectInput) => WorkspaceProject;
  updateProject: (id: string, patch: Partial<Pick<WorkspaceProject, "title" | "summary" | "status" | "progress" | "next_action" | "due_date" | "tags">>) => void;
  createTask: (input: TaskInput) => WorkspaceTask;
  updateTask: (id: string, patch: Partial<Pick<WorkspaceTask, "title" | "status" | "priority" | "due_date" | "tags" | "project_id">>) => void;
  createKnowledge: (input: KnowledgeInput) => KnowledgeItem;
  updateKnowledge: (id: string, patch: Partial<Pick<KnowledgeItem, "kind" | "title" | "content" | "url" | "tags">>) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function storageKey(userId: number) {
  return `hua-workspace:v1:${userId}`;
}

function id() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function now() {
  return new Date().toISOString();
}

function activity(
  userId: number,
  module: WorkspaceActivity["module"],
  action: WorkspaceActivity["action"],
  entityType: WorkspaceActivity["entity_type"],
  entityId: string,
  title: string,
): WorkspaceActivity {
  const timestamp = now();
  return { id: id(), user_id: userId, module, action, entity_type: entityType, entity_id: entityId, title, created_at: timestamp, updated_at: timestamp };
}

function normalize(data: Partial<WorkspaceData>): WorkspaceData {
  return {
    version: 1,
    projects: Array.isArray(data.projects) ? data.projects : [],
    tasks: Array.isArray(data.tasks) ? data.tasks : [],
    knowledge: Array.isArray(data.knowledge) ? data.knowledge : [],
    activities: Array.isArray(data.activities) ? data.activities : [],
  };
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [data, setData] = useState<WorkspaceData>(EMPTY_WORKSPACE);
  const [isLoading, setIsLoading] = useState(true);
  const [loadedUserId, setLoadedUserId] = useState<number | null>(null);

  useEffect(() => {
    if (!user) {
      setData(EMPTY_WORKSPACE);
      setLoadedUserId(null);
      setIsLoading(false);
      return;
    }
    try {
      const saved = window.localStorage.getItem(storageKey(user.id));
      setData(saved ? normalize(JSON.parse(saved)) : EMPTY_WORKSPACE);
      setLoadedUserId(user.id);
    } catch {
      setData(EMPTY_WORKSPACE);
      setLoadedUserId(user.id);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user || isLoading || loadedUserId !== user.id) return;
    window.localStorage.setItem(storageKey(user.id), JSON.stringify(data));
  }, [data, isLoading, loadedUserId, user]);

  function requireUser() {
    if (!user) throw new Error("Workspace requires an authenticated user");
    return user;
  }

  function createProject(input: ProjectInput) {
    const owner = requireUser();
    const timestamp = now();
    const project: WorkspaceProject = {
      id: id(), user_id: owner.id, module: "projects", created_at: timestamp, updated_at: timestamp,
      title: input.title.trim(), summary: input.summary?.trim() ?? "", status: input.status ?? "active",
      progress: 0, next_action: input.next_action?.trim() ?? "", due_date: input.due_date || undefined, tags: input.tags ?? [],
    };
    setData((current) => ({ ...current, projects: [project, ...current.projects], activities: [activity(owner.id, "projects", "created", "project", project.id, project.title), ...current.activities].slice(0, 50) }));
    return project;
  }

  function updateProject(projectId: string, patch: Partial<Pick<WorkspaceProject, "title" | "summary" | "status" | "progress" | "next_action" | "due_date" | "tags">>) {
    const owner = requireUser();
    setData((current) => {
      const existing = current.projects.find((project) => project.id === projectId);
      if (!existing) return current;
      const updated = { ...existing, ...patch, progress: patch.progress == null ? existing.progress : Math.max(0, Math.min(100, patch.progress)), updated_at: now() };
      return { ...current, projects: current.projects.map((project) => project.id === projectId ? updated : project), activities: [activity(owner.id, "projects", patch.status === "completed" ? "completed" : "updated", "project", projectId, updated.title), ...current.activities].slice(0, 50) };
    });
  }

  function createTask(input: TaskInput) {
    const owner = requireUser();
    const timestamp = now();
    const task: WorkspaceTask = {
      id: id(), user_id: owner.id, module: "tasks", created_at: timestamp, updated_at: timestamp,
      title: input.title.trim(), status: "todo", priority: input.priority ?? "medium", due_date: input.due_date || undefined,
      tags: input.tags ?? [], project_id: input.project_id || undefined, related_job_id: input.related_job_id,
    };
    setData((current) => ({ ...current, tasks: [task, ...current.tasks], activities: [activity(owner.id, "tasks", "created", "task", task.id, task.title), ...current.activities].slice(0, 50) }));
    return task;
  }

  function updateTask(taskId: string, patch: Partial<Pick<WorkspaceTask, "title" | "status" | "priority" | "due_date" | "tags" | "project_id">>) {
    const owner = requireUser();
    setData((current) => {
      const existing = current.tasks.find((task) => task.id === taskId);
      if (!existing) return current;
      const updated = { ...existing, ...patch, updated_at: now() };
      return { ...current, tasks: current.tasks.map((task) => task.id === taskId ? updated : task), activities: [activity(owner.id, "tasks", patch.status === "done" ? "completed" : "updated", "task", taskId, updated.title), ...current.activities].slice(0, 50) };
    });
  }

  function createKnowledge(input: KnowledgeInput) {
    const owner = requireUser();
    const timestamp = now();
    const item: KnowledgeItem = {
      id: id(), user_id: owner.id, module: "knowledge", created_at: timestamp, updated_at: timestamp,
      kind: input.kind ?? "note", title: input.title.trim(), content: input.content?.trim() ?? "", url: input.url?.trim() || undefined, tags: input.tags ?? [],
    };
    setData((current) => ({ ...current, knowledge: [item, ...current.knowledge], activities: [activity(owner.id, "knowledge", "created", "knowledge", item.id, item.title), ...current.activities].slice(0, 50) }));
    return item;
  }

  function updateKnowledge(itemId: string, patch: Partial<Pick<KnowledgeItem, "kind" | "title" | "content" | "url" | "tags">>) {
    const owner = requireUser();
    setData((current) => {
      const existing = current.knowledge.find((item) => item.id === itemId);
      if (!existing) return current;
      const updated = { ...existing, ...patch, updated_at: now() };
      return { ...current, knowledge: current.knowledge.map((item) => item.id === itemId ? updated : item), activities: [activity(owner.id, "knowledge", "updated", "knowledge", itemId, updated.title), ...current.activities].slice(0, 50) };
    });
  }

  const value: WorkspaceContextValue = { ...data, isLoading, createProject, updateProject, createTask, updateTask, createKnowledge, updateKnowledge };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return context;
}
