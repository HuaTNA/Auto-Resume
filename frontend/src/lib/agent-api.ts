import { getApiBase } from "./api-base";
import type { AgentApplication } from "./agent-types";

function apiRoot() {
  const configured = process.env.NEXT_PUBLIC_AGENT_API_BASE?.replace(/\/$/, "");
  return configured || `${getApiBase()}/api`;
}

function idempotencyKey(scope: string) {
  const storageKey = `hua-idempotency:${scope}`;
  if (typeof window !== "undefined") {
    const existing = window.sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const created = `${scope}:${crypto.randomUUID()}`;
    window.sessionStorage.setItem(storageKey, created);
    return created;
  }
  return `${scope}:${crypto.randomUUID()}`;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${apiRoot()}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    const detail = body.detail;
    throw new Error(typeof detail === "string" ? detail : detail?.message || "Agent request failed");
  }
  return response.json() as Promise<T>;
}

function canonicalAgent(payload: AgentApplication | { agent: AgentApplication }) {
  return "agent" in payload ? payload.agent : payload;
}

export async function listAgentApplications(): Promise<AgentApplication[]> {
  const career = await request<{ applications: Array<{ id: string }> }>("/career/applications");
  const details = await Promise.all(career.applications.map(({ id }) => getAgentApplication(id)));
  return details;
}

export function getAgentApplication(id: string) {
  return request<AgentApplication | { agent: AgentApplication }>(`/agent/applications/${encodeURIComponent(id)}`).then(canonicalAgent);
}

export function saveApplicationAnswer(application: AgentApplication, questionKey: string, question: string, answer: string, saveToLibrary: boolean) {
  return request<AgentApplication | { agent: AgentApplication }>(`/agent/applications/${application.id}/answers/${encodeURIComponent(questionKey)}`, {
    method: "PUT",
    headers: { "Idempotency-Key": idempotencyKey(`answer:${application.id}:${application.version}:${questionKey}`) },
    body: JSON.stringify({ question_key: questionKey, question, answer, required: true, save_to_library: saveToLibrary }),
  }).then(canonicalAgent);
}

export function requestApplicationApproval(application: AgentApplication) {
  return request<AgentApplication | { agent: AgentApplication }>(`/agent/applications/${application.id}/transitions`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey(`transition:${application.id}:${application.version}:request-approval`) },
    body: JSON.stringify({ action: "request_approval", expected_version: application.version, reason: "Requested from mobile control center" }),
  }).then(canonicalAgent);
}

export function decideApproval(application: AgentApplication, decision: "approved" | "rejected") {
  if (!application.latest_approval) throw new Error("No pending approval");
  return request<AgentApplication | { agent: AgentApplication }>(`/agent/approvals/${application.latest_approval.id}/decision`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey(`approval:${application.latest_approval.id}:${application.version}`) },
    body: JSON.stringify({ decision, expected_version: application.version, note: "Decision from mobile control center" }),
  }).then(canonicalAgent);
}

export function createSubmission(application: AgentApplication) {
  if (!application.latest_approval || application.latest_approval.status !== "approved") throw new Error("A current approval is required");
  return request<AgentApplication | { agent: AgentApplication }>(`/agent/applications/${application.id}/submissions`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey(`submission:${application.id}:${application.latest_approval.id}`) },
    body: JSON.stringify({ provider: application.job.provider }),
  }).then(canonicalAgent);
}
