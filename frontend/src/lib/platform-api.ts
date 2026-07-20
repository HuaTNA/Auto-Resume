import { getApiBase } from "./api-base";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBase()}${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...options });
  if (response.status === 401) {
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new Error("Not authenticated");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(body.detail || "Request failed");
  }
  return response.json() as Promise<T>;
}

export interface PlatformDocument {
  id: string; title: string; kind: string; owner_module: string; status: string;
  source_record_id?: number; version_count: number; created_at: string; updated_at: string;
}

export interface PlatformDocumentVersion {
  id: string; version_number: number; content: string; storage_path?: string; metadata: Record<string, unknown>; created_at: string;
}

export function listDocuments() { return request<{ documents: PlatformDocument[] }>("/api/documents"); }
export function createDocument(input: { title: string; kind?: string; content?: string; metadata?: Record<string, unknown> }) {
  return request<{ document: PlatformDocument }>("/api/documents", { method: "POST", body: JSON.stringify(input) });
}
export function getDocument(id: string) { return request<{ document: PlatformDocument; versions: PlatformDocumentVersion[] }>(`/api/documents/${id}`); }
export function updateDocument(id: string, patch: { title?: string; kind?: string; status?: string }) { return request<{ document: PlatformDocument }>(`/api/documents/${id}`, { method: "PATCH", body: JSON.stringify(patch) }); }
export function createDocumentVersion(id: string, content: string) { return request<{ version: PlatformDocumentVersion }>(`/api/documents/${id}/versions`, { method: "POST", body: JSON.stringify({ content }) }); }
export function deleteDocument(id: string) { return request<{ ok: true }>(`/api/documents/${id}`, { method: "DELETE" }); }

export interface InterviewApplication { id: number; job_title: string; company: string; status: string; timestamp: string; }
export interface InterviewNote { id: string; application_record_id: number; kind: string; title: string; content: string; created_at: string; updated_at: string; }
export function listInterviews() { return request<{ applications: InterviewApplication[]; notes: InterviewNote[] }>("/api/interviews"); }
export function createInterviewNote(input: { application_record_id: number; kind: string; title: string; content: string }) {
  return request<{ note: InterviewNote }>("/api/interviews/notes", { method: "POST", body: JSON.stringify(input) });
}

export interface PlatformAutomation { id: string; name: string; kind: string; schedule?: string; enabled: boolean; max_retries: number; next_run_at?: string; last_run_at?: string; config: Record<string, unknown>; created_at: string; updated_at: string; }
export interface AutomationJobResult { job_id?: string; title: string; company: string; location: string; description: string; url: string; source: "indeed" | "adzuna" | string; salary_min?: number; salary_max?: number; created: string; match_score: number; match_reason: string; is_new?: boolean; application_record_id?: number; approval_status?: string; materials_generated?: boolean; generation_warning?: string; }
export interface AutomationRun { id: string; automation_id: string; status: string; trigger: string; attempt_count: number; counts: Record<string, number>; result?: { query?: string; location?: string; sources?: string[]; source_warnings?: string[]; jobs?: AutomationJobResult[]; ranking_warning?: string | null; approval_required?: boolean }; error?: string; created_at: string; }
export function listAutomations() { return request<{ automations: PlatformAutomation[]; runs: AutomationRun[] }>("/api/automations"); }
export function createAutomation(input: { name: string; kind: string; schedule?: string; max_retries?: number; config?: Record<string, unknown> }) { return request<{ automation: PlatformAutomation }>("/api/automations", { method: "POST", body: JSON.stringify(input) }); }
export function updateAutomation(id: string, patch: { enabled?: boolean; schedule?: string }) { return request<{ automation: PlatformAutomation }>(`/api/automations/${id}`, { method: "PATCH", body: JSON.stringify(patch) }); }
export function runAutomation(id: string) { return request<{ run: AutomationRun }>(`/api/automations/${id}/runs`, { method: "POST" }); }
export function generateJobMaterials(jobId: string) { return request<{ ok: true; application_record_id: number }>(`/api/career/jobs/${jobId}/generate-materials`, { method: "POST" }); }

export interface WorkspaceNotification { id: string; kind: string; title: string; message: string; href?: string; read_at?: string; created_at: string; }
export function listNotifications(unreadOnly = false) { return request<{ notifications: WorkspaceNotification[] }>(`/api/notifications${unreadOnly ? "?unread_only=true" : ""}`); }
export function markNotificationRead(id: string) { return request<{ ok: true }>(`/api/notifications/${id}/read`, { method: "PATCH" }); }

export interface PlatformIntegration { id: string; provider: string; state: string; scopes: string[]; external_account?: string; updated_at: string; }
export interface IntegrationProvider { id: string; name: string; configured: boolean; scopes: string[]; }
export function listIntegrations() { return request<{ integrations: PlatformIntegration[]; providers: IntegrationProvider[] }>("/api/integrations"); }
export function integrationAuthorizeUrl(provider: string) { return `${getApiBase()}/api/integrations/${provider}/authorize`; }
export function syncIntegration(provider: string) { return request<{ ok: true; provider: string; imported: number; skipped: number }>(`/api/integrations/${provider}/sync`, { method: "POST" }); }
export function connectIntegration(provider: string, input: { scopes?: string[]; external_account?: string }) { return request<{ integration: PlatformIntegration }>(`/api/integrations/${provider}`, { method: "PUT", body: JSON.stringify({ ...input, state: "connected" }) }); }
export function disconnectIntegration(provider: string) { return request<{ ok: true }>(`/api/integrations/${provider}`, { method: "DELETE" }); }

export interface Conversation { id: string; title: string; created_at: string; updated_at: string; }
export interface CopilotMessage { id: string; role: "user" | "assistant"; content: string; citations?: Array<{ type: string; id: string | number; title: string }>; created_at: string; }
export function listConversations() { return request<{ conversations: Conversation[] }>("/api/copilot/conversations"); }
export function createConversation(title: string) { return request<{ conversation: Conversation }>("/api/copilot/conversations", { method: "POST", body: JSON.stringify({ title }) }); }
export function getConversation(id: string) { return request<{ conversation: Conversation; messages: CopilotMessage[] }>(`/api/copilot/conversations/${id}`); }
export function sendCopilotMessage(id: string, content: string) { return request<{ user_message: CopilotMessage; assistant_message: CopilotMessage }>(`/api/copilot/conversations/${id}/messages`, { method: "POST", body: JSON.stringify({ content }) }); }
