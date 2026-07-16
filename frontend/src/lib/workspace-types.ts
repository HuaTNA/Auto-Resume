export type WorkspaceModuleId =
  | "home"
  | "career"
  | "projects"
  | "tasks"
  | "knowledge"
  | "documents"
  | "automations"
  | "integrations"
  | "copilot"
  | "settings";

export interface WorkspaceEntity {
  id: string;
  user_id: number;
  module: WorkspaceModuleId;
  created_at: string;
  updated_at: string;
}

export type ProjectStatus = "planned" | "active" | "blocked" | "completed";

export interface WorkspaceProject extends WorkspaceEntity {
  module: "projects";
  title: string;
  summary: string;
  status: ProjectStatus;
  progress: number;
  next_action: string;
  due_date?: string;
  tags: string[];
}

export type TaskPriority = "low" | "medium" | "high";
export type TaskStatus = "todo" | "done";

export interface WorkspaceTask extends WorkspaceEntity {
  module: "tasks";
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_date?: string;
  tags: string[];
  project_id?: string;
  related_job_id?: number;
}

export type KnowledgeKind = "note" | "research" | "link";

export interface KnowledgeItem extends WorkspaceEntity {
  module: "knowledge";
  kind: KnowledgeKind;
  title: string;
  content: string;
  url?: string;
  tags: string[];
}

export interface WorkspaceActivity extends WorkspaceEntity {
  module: WorkspaceModuleId;
  action: "created" | "updated" | "completed";
  entity_type: "project" | "task" | "knowledge";
  entity_id: string;
  title: string;
}

export interface WorkspaceData {
  version: 1;
  projects: WorkspaceProject[];
  tasks: WorkspaceTask[];
  knowledge: KnowledgeItem[];
  activities: WorkspaceActivity[];
}

export const EMPTY_WORKSPACE: WorkspaceData = {
  version: 1,
  projects: [],
  tasks: [],
  knowledge: [],
  activities: [],
};
