import { redactForDiscord } from "./redaction.js";
import type { AgentResource, Approval, ApprovalDecision, ApprovalDecisionResponse, RecommendationBatch, RecommendationItem, TransitionResponse } from "./types.js";

export interface ApiClientConfig { baseUrl: string; serviceToken: string; requestTimeoutMs?: number }
export interface RequestScope {
  discordUserId: string;
  discordChannelId: string;
  discordMessageId: string;
  idempotencyKey: string;
}

type Fetch = typeof globalThis.fetch;

export const API_PATHS = {
  latestBatch: "/api/agent/recommendation-batches/latest",
  batch: (id: string) => `/api/agent/recommendation-batches/${encodeURIComponent(id)}`,
  agent: (id: string) => `/api/agent/applications/${encodeURIComponent(id)}`,
  transition: (id: string) => `/api/agent/applications/${encodeURIComponent(id)}/transitions`,
  materials: (id: string) => `/api/agent/applications/${encodeURIComponent(id)}/materials`,
  approvalDecision: (id: string) => `/api/agent/approvals/${encodeURIComponent(id)}/decision`,
} as const;

export class AgentApiError extends Error {
  constructor(public readonly code: string, public readonly retryable: boolean, public readonly status: number, requestId?: string | null) {
    super(`Auto Resume API 请求失败（${code}，HTTP ${status}${requestId ? `，request ID: ${requestId}` : ""}）`); this.name = "AgentApiError";
  }
}

function record(value: unknown, label = "response"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`API ${label} 不是对象`);
  return value as Record<string, unknown>;
}
function string(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) throw new Error(`API 响应缺少 ${field}`);
  return value;
}
function optional(value: unknown): string | undefined { return typeof value === "string" && value ? value : undefined; }
function integer(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`API 响应缺少有效 ${field}`);
  return Number(value);
}
function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function approval(value: unknown): Approval | undefined {
  if (value == null) return undefined;
  const row = record(value, "approval");
  return {
    id: string(row.id, "approval.id"), status: string(row.status, "approval.status"),
    contentDigest: string(row.content_digest, "approval.content_digest"), version: integer(row.version, "approval.version"),
    requestedNote: optional(row.requested_note), decisionNote: optional(row.decision_note), decidedAt: optional(row.decided_at),
    createdAt: string(row.created_at, "approval.created_at"), updatedAt: string(row.updated_at, "approval.updated_at"),
  };
}

function agent(value: unknown): AgentResource {
  const row = record(value, "agent");
  const receipt = row.latest_receipt == null ? undefined : record(row.latest_receipt, "receipt");
  return {
    id: string(row.id, "agent.id"), applicationId: string(row.application_id, "agent.application_id"),
    state: string(row.state, "agent.state"), version: integer(row.version, "agent.version"), latestApproval: approval(row.latest_approval),
    atsScore: optionalNumber(row.ats_score), atsRounds: optionalNumber(row.ats_rounds),
    resumeVersion: optionalNumber(row.resume_version),
    latestReceipt: receipt ? { id: string(receipt.id, "receipt.id"), status: string(receipt.status, "receipt.status") } : undefined,
    updatedAt: string(row.updated_at, "agent.updated_at"),
  };
}

function item(value: unknown): RecommendationItem {
  const row = record(value, "batch item"); const job = record(row.job, "job");
  return {
    id: string(row.id, "item.id"), position: Number(row.position),
    job: { id: string(job.id, "job.id"), title: string(job.title, "job.title"), company: string(job.company, "job.company"), location: optional(job.location), source: optional(job.source), sourceUrl: optional(job.source_url) },
    applicationId: string(row.application_id, "item.application_id"), agentId: string(row.agent_id, "item.agent_id"), agentState: string(row.agent_state, "item.agent_state"),
  };
}

export class AutoResumeApiClient {
  readonly #baseUrl: string; readonly #serviceToken: string; readonly #timeoutMs: number; readonly #fetch: Fetch;
  constructor(config: ApiClientConfig, fetchImpl: Fetch = globalThis.fetch) {
    const url = new URL(config.baseUrl);
    if (!(["http:", "https:"] as string[]).includes(url.protocol)) throw new Error("baseUrl 必须使用 HTTP(S)");
    if (!config.serviceToken) throw new Error("serviceToken 未配置");
    this.#baseUrl = url.toString().replace(/\/$/, ""); this.#serviceToken = config.serviceToken;
    this.#timeoutMs = config.requestTimeoutMs ?? 10_000; this.#fetch = fetchImpl;
  }

  async #request(path: string, scope: RequestScope, init: RequestInit = {}, longRunning = false): Promise<unknown> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init, redirect: "error", signal: AbortSignal.timeout(longRunning ? Math.max(this.#timeoutMs, 240_000) : this.#timeoutMs),
      headers: { Accept: "application/json", Authorization: `Bearer ${this.#serviceToken}`, "Content-Type": "application/json", "Idempotency-Key": scope.idempotencyKey,
        "X-Discord-User-Id": scope.discordUserId, "X-Discord-Channel-Id": scope.discordChannelId,
        "X-Discord-Message-Id": scope.discordMessageId, ...init.headers },
    });
    if (!response.ok) {
      let payload: unknown;
      try { payload = await response.json(); } catch { payload = undefined; }
      const detail = payload && typeof payload === "object" ? (payload as Record<string, unknown>).detail : undefined;
      const safe = detail && typeof detail === "object" ? redactForDiscord(detail) as Record<string, unknown> : undefined;
      const code = optional(safe?.code) ?? "agent.http_error";
      throw new AgentApiError(code, safe?.retryable === true, response.status, response.headers.get("x-request-id"));
    }
    return response.status === 204 ? {} : response.json();
  }

  async getWorkspace(scope: RequestScope): Promise<Record<string, unknown>> {
    return record(await this.#request("/api/agent/workspace", scope));
  }

  async search(query: string, location: string, scope: RequestScope): Promise<Record<string, unknown>> {
    return record(await this.#request("/api/agent/searches", scope, {
      method: "POST", body: JSON.stringify({ query, location, max_results: 15 }),
    }, true));
  }

  async getSearch(id: string, scope: RequestScope): Promise<Record<string, unknown>> {
    return record(await this.#request(`/api/agent/searches/${encodeURIComponent(id)}`, scope));
  }

  async getBatch(id: string, scope: RequestScope): Promise<RecommendationBatch> {
    const row = record(await this.#request(API_PATHS.batch(id), scope));
    const result = { id: string(row.id, "batch.id"), label: typeof row.label === "string" ? row.label : "", status: string(row.status, "batch.status"),
      items: Array.isArray(row.items) ? row.items.map(item).sort((a, b) => a.position - b.position) : [], createdAt: string(row.created_at, "batch.created_at"), updatedAt: string(row.updated_at, "batch.updated_at") };
    if (result.id !== id) throw new Error("API batch 响应与请求范围不一致");
    return result;
  }

  async getLatestBatch(scope: RequestScope): Promise<RecommendationBatch> {
    const row = record(await this.#request(API_PATHS.latestBatch, scope));
    return { id: string(row.id, "batch.id"), label: typeof row.label === "string" ? row.label : "", status: string(row.status, "batch.status"),
      items: Array.isArray(row.items) ? row.items.map(item).sort((a, b) => a.position - b.position) : [], createdAt: string(row.created_at, "batch.created_at"), updatedAt: string(row.updated_at, "batch.updated_at") };
  }

  async getAgent(id: string, scope: RequestScope): Promise<AgentResource> {
    const row = record(await this.#request(API_PATHS.agent(id), scope)); const result = agent(row.agent);
    if (result.id !== id) throw new Error("API agent 响应与请求范围不一致");
    return result;
  }

  async startAgent(id: string, expectedVersion: number, scope: RequestScope): Promise<TransitionResponse> {
    const row = record(await this.#request(API_PATHS.transition(id), scope, { method: "POST", body: JSON.stringify({ action: "start", expected_version: expectedVersion, reason: "Selected from Discord recommendation digest" }) }));
    const result = { agent: agent(row.agent) };
    if (result.agent.id !== id) throw new Error("API transition 响应与请求范围不一致");
    return result;
  }

  async prepareMaterials(id: string, scope: RequestScope): Promise<TransitionResponse> {
    const row = record(await this.#request(API_PATHS.materials(id), scope, {
      method: "POST",
      body: JSON.stringify({ target_ats_score: 85, max_optimization_rounds: 2, template: "classic", generate_cover_letter: true }),
    }, true));
    const result = { agent: agent(row.agent) };
    if (result.agent.id !== id) throw new Error("API materials 响应与请求范围不一致");
    return result;
  }

  async requestApproval(id: string, expectedVersion: number, scope: RequestScope): Promise<TransitionResponse> {
    const row = record(await this.#request(API_PATHS.transition(id), scope, {
      method: "POST",
      body: JSON.stringify({ action: "request_approval", expected_version: expectedVersion, reason: "Materials generated from Discord selection; human review required" }),
    }));
    const result = { agent: agent(row.agent) };
    if (result.agent.id !== id) throw new Error("API approval transition 响应与请求范围不一致");
    return result;
  }

  async decideApproval(id: string, decision: ApprovalDecision, expectedVersion: number, note: string | undefined, scope: RequestScope): Promise<ApprovalDecisionResponse> {
    const row = record(await this.#request(API_PATHS.approvalDecision(id), scope, { method: "POST", body: JSON.stringify({ decision, expected_version: expectedVersion, note: note ?? "" }) }));
    const resultApproval = approval(row.approval); if (!resultApproval) throw new Error("API 响应缺少 approval");
    if (resultApproval.id !== id) throw new Error("API approval 响应与请求范围不一致");
    return { approval: resultApproval, agent: agent(row.agent) };
  }
}
