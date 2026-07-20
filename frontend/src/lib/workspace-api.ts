import type {
  KnowledgeItem,
  KnowledgeKind,
  ProjectStatus,
  TaskPriority,
  WorkspaceData,
  WorkspaceProject,
  WorkspaceTask,
} from "@/lib/workspace-types";

import { getApiBase } from "./api-base";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBase()}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (response.status === 401) {
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new Error("Not authenticated");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(body.detail || "Workspace request failed");
  }
  return response.json() as Promise<T>;
}

export interface ProjectInput {
  title: string;
  summary?: string;
  status?: ProjectStatus;
  next_action?: string;
  due_date?: string;
  tags?: string[];
}

export interface TaskInput {
  title: string;
  priority?: TaskPriority;
  due_date?: string;
  tags?: string[];
  project_id?: string;
  related_job_id?: number;
}

export interface KnowledgeInput {
  kind?: KnowledgeKind;
  title: string;
  content?: string;
  url?: string;
  tags?: string[];
}

export function getWorkspace() {
  return request<WorkspaceData>("/api/workspace");
}

export function importWorkspace(data: Pick<WorkspaceData, "projects" | "tasks" | "knowledge">) {
  return request<{ ok: true; imported: Record<string, number> }>("/api/workspace/import", { method: "POST", body: JSON.stringify(data) });
}

export function createWorkspaceProject(input: ProjectInput) {
  return request<{ project: WorkspaceProject }>("/api/workspace/projects", { method: "POST", body: JSON.stringify(input) });
}

export function updateWorkspaceProject(id: string, patch: Partial<Pick<WorkspaceProject, "title" | "summary" | "status" | "progress" | "next_action" | "due_date" | "tags">>) {
  return request<{ project: WorkspaceProject }>(`/api/workspace/projects/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteWorkspaceProject(id: string) {
  return request<{ ok: true }>(`/api/workspace/projects/${id}`, { method: "DELETE" });
}

export function createWorkspaceTask(input: TaskInput) {
  return request<{ task: WorkspaceTask }>("/api/workspace/tasks", { method: "POST", body: JSON.stringify(input) });
}

export function updateWorkspaceTask(id: string, patch: Partial<Pick<WorkspaceTask, "title" | "status" | "priority" | "due_date" | "tags" | "project_id">>) {
  return request<{ task: WorkspaceTask }>(`/api/workspace/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteWorkspaceTask(id: string) {
  return request<{ ok: true }>(`/api/workspace/tasks/${id}`, { method: "DELETE" });
}

export function createWorkspaceKnowledge(input: KnowledgeInput) {
  return request<{ item: KnowledgeItem }>("/api/workspace/knowledge", { method: "POST", body: JSON.stringify(input) });
}

export function updateWorkspaceKnowledge(id: string, patch: Partial<Pick<KnowledgeItem, "kind" | "title" | "content" | "url" | "tags">>) {
  return request<{ item: KnowledgeItem }>(`/api/workspace/knowledge/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteWorkspaceKnowledge(id: string) {
  return request<{ ok: true }>(`/api/workspace/knowledge/${id}`, { method: "DELETE" });
}
