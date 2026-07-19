"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  createWorkspaceKnowledge,
  createWorkspaceProject,
  createWorkspaceTask,
  deleteWorkspaceKnowledge,
  deleteWorkspaceProject,
  deleteWorkspaceTask,
  getWorkspace,
  importWorkspace,
  KnowledgeInput,
  ProjectInput,
  TaskInput,
  updateWorkspaceKnowledge,
  updateWorkspaceProject,
  updateWorkspaceTask,
} from "@/lib/workspace-api";
import {
  EMPTY_WORKSPACE,
  KnowledgeItem,
  WorkspaceData,
  WorkspaceProject,
  WorkspaceTask,
} from "@/lib/workspace-types";

interface WorkspaceContextValue extends WorkspaceData {
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createProject: (input: ProjectInput) => Promise<WorkspaceProject>;
  updateProject: (id: string, patch: Partial<Pick<WorkspaceProject, "title" | "summary" | "status" | "progress" | "next_action" | "due_date" | "tags">>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  createTask: (input: TaskInput) => Promise<WorkspaceTask>;
  updateTask: (id: string, patch: Partial<Pick<WorkspaceTask, "title" | "status" | "priority" | "due_date" | "tags" | "project_id">>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  createKnowledge: (input: KnowledgeInput) => Promise<KnowledgeItem>;
  updateKnowledge: (id: string, patch: Partial<Pick<KnowledgeItem, "kind" | "title" | "content" | "url" | "tags">>) => Promise<void>;
  deleteKnowledge: (id: string) => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function legacyStorageKey(userId: number) {
  return `hua-workspace:v1:${userId}`;
}

function migrationKey(userId: number) {
  return `hua-workspace:server-migrated:v1:${userId}`;
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
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setData(EMPTY_WORKSPACE);
      return;
    }
    const result = await getWorkspace();
    setData(normalize(result));
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!user) {
        if (!cancelled) { setData(EMPTY_WORKSPACE); setIsLoading(false); setError(null); }
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const saved = window.localStorage.getItem(legacyStorageKey(user.id));
        const migrated = window.localStorage.getItem(migrationKey(user.id));
        if (saved && !migrated) {
          const legacy = normalize(JSON.parse(saved));
          await importWorkspace({ projects: legacy.projects, tasks: legacy.tasks, knowledge: legacy.knowledge });
          window.localStorage.setItem(migrationKey(user.id), new Date().toISOString());
        }
        const result = await getWorkspace();
        if (!cancelled) setData(normalize(result));
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Workspace could not be loaded");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [user]);

  async function createProject(input: ProjectInput) {
    const result = await createWorkspaceProject(input);
    await refresh();
    return result.project;
  }

  async function updateProject(id: string, patch: Partial<Pick<WorkspaceProject, "title" | "summary" | "status" | "progress" | "next_action" | "due_date" | "tags">>) {
    await updateWorkspaceProject(id, patch);
    await refresh();
  }

  async function deleteProject(id: string) { await deleteWorkspaceProject(id); await refresh(); }

  async function createTask(input: TaskInput) {
    const result = await createWorkspaceTask(input);
    await refresh();
    return result.task;
  }

  async function updateTask(id: string, patch: Partial<Pick<WorkspaceTask, "title" | "status" | "priority" | "due_date" | "tags" | "project_id">>) {
    await updateWorkspaceTask(id, patch);
    await refresh();
  }

  async function deleteTask(id: string) { await deleteWorkspaceTask(id); await refresh(); }

  async function createKnowledge(input: KnowledgeInput) {
    const result = await createWorkspaceKnowledge(input);
    await refresh();
    return result.item;
  }

  async function updateKnowledge(id: string, patch: Partial<Pick<KnowledgeItem, "kind" | "title" | "content" | "url" | "tags">>) {
    await updateWorkspaceKnowledge(id, patch);
    await refresh();
  }

  async function deleteKnowledge(id: string) { await deleteWorkspaceKnowledge(id); await refresh(); }

  const value: WorkspaceContextValue = {
    ...data, isLoading, error, refresh,
    createProject, updateProject, deleteProject,
    createTask, updateTask, deleteTask,
    createKnowledge, updateKnowledge, deleteKnowledge,
  };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return context;
}
