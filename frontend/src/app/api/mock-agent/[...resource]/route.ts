import { NextRequest, NextResponse } from "next/server";
import { MOCK_AGENT_APPLICATIONS } from "@/lib/agent-mock-data";
import type { AgentApplication } from "@/lib/agent-types";

const globalStore = globalThis as typeof globalThis & { __huaAgentMock?: AgentApplication[] };

function store() {
  globalStore.__huaAgentMock ??= structuredClone(MOCK_AGENT_APPLICATIONS);
  return globalStore.__huaAgentMock;
}

function unavailable() {
  return NextResponse.json({ detail: "Mock Agent API is disabled" }, { status: 404 });
}

function enabled() {
  return process.env.NODE_ENV !== "production" && process.env.AGENT_MOCK_API === "true";
}

function validateJsonHeader(request: NextRequest) {
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return NextResponse.json({ detail: [{ loc: ["body"], msg: "Input should be a valid dictionary", type: "model_attributes_type" }] }, { status: 422 });
  }
  return null;
}

function response(application: AgentApplication) {
  return NextResponse.json(application, { headers: { "X-Auto-Resume-Mock": "true", "Cache-Control": "no-store" } });
}

function applicationById(id: string) {
  return store().find((item) => item.id === id);
}

export async function GET(_request: NextRequest, context: { params: Promise<{ resource: string[] }> }) {
  if (!enabled()) return unavailable();
  const resource = (await context.params).resource;
  if (resource.join("/") === "agent/applications") {
    const view = _request.nextUrl.searchParams.get("view") || "applications";
    const offset = Number(_request.nextUrl.searchParams.get("offset") || 0);
    const limit = Number(_request.nextUrl.searchParams.get("limit") || 25);
    const groups = { applications: store().filter((item) => item.state !== "discovered"), new_jobs: store().filter((item) => item.state === "discovered"), inbox: store().filter((item) => ["awaiting_answers", "awaiting_approval", "needs_attention"].includes(item.state)) };
    const items = groups[view as keyof typeof groups] || [];
    return NextResponse.json({ applications: items.slice(offset, offset + limit).map(({ id, state, version, match_score, job, updated_at }) => ({ id, state, version, match_score, job, updated_at })), counts: { applications: groups.applications.length, new_jobs: groups.new_jobs.length, inbox: groups.inbox.length }, total: items.length, offset, limit });
  }
  if (resource.join("/") === "career/applications") {
    return NextResponse.json({ applications: store().map(({ id }) => ({ id })) }, { headers: { "X-Auto-Resume-Mock": "true" } });
  }
  if (resource[0] === "agent" && resource[1] === "applications" && resource.length === 3) {
    const application = applicationById(resource[2]);
    return application ? response(application) : NextResponse.json({ detail: { code: "agent.not_found", message: "Application not found", retryable: false, context: {} } }, { status: 404 });
  }
  return unavailable();
}

export async function PUT(request: NextRequest, context: { params: Promise<{ resource: string[] }> }) {
  if (!enabled()) return unavailable();
  const invalidHeader = validateJsonHeader(request);
  if (invalidHeader) return invalidHeader;
  const resource = (await context.params).resource;
  const application = resource[0] === "agent" && resource[1] === "applications" ? applicationById(resource[2]) : undefined;
  if (!application || resource[3] !== "answers" || !resource[4]) return unavailable();
  const body = await request.json();
  if (!request.headers.get("Idempotency-Key")) return NextResponse.json({ detail: { code: "agent.idempotency_required", message: "Idempotency-Key is required", retryable: false, context: {} } }, { status: 400 });
  const answer = application.answers.find((item) => item.question_key === resource[4]);
  if (!answer || !String(body.answer || "").trim()) return NextResponse.json({ detail: { code: "agent.validation_failed", message: "A required answer cannot be empty", retryable: false, context: {} } }, { status: 422 });
  answer.answer = String(body.answer).trim();
  application.version += 1;
  application.updated_at = new Date().toISOString();
  application.timeline.unshift({ id: crypto.randomUUID(), kind: "answer", title: "Answer saved", detail: body.save_to_library ? "Saved here and marked for the reusable answer library." : "Saved for this application only.", created_at: application.updated_at });
  return response(application);
}

export async function POST(request: NextRequest, context: { params: Promise<{ resource: string[] }> }) {
  if (!enabled()) return unavailable();
  if ((await context.params).resource.join("/") === "reset") {
    globalStore.__huaAgentMock = structuredClone(MOCK_AGENT_APPLICATIONS);
    return NextResponse.json({ ok: true });
  }
  const invalidHeader = validateJsonHeader(request);
  if (invalidHeader) return invalidHeader;
  const resource = (await context.params).resource;
  const body = await request.json();
  if (!request.headers.get("Idempotency-Key")) return NextResponse.json({ detail: { code: "agent.idempotency_required", message: "Idempotency-Key is required", retryable: false, context: {} } }, { status: 400 });

  if (resource[0] === "agent" && resource[1] === "applications" && resource[3] === "transitions") {
    const application = applicationById(resource[2]);
    if (!application) return unavailable();
    if (body.expected_version !== application.version) return NextResponse.json({ detail: { code: "agent.invalid_state_transition", message: "Application version is stale", retryable: true, context: {} } }, { status: 409 });
    if (body.action === "start" && application.state === "discovered") {
      application.state = "preparing"; application.version += 1;
      return response(application);
    }
    if (body.action !== "request_approval" || application.answers.some((item) => item.required && !item.answer.trim())) return NextResponse.json({ detail: { code: "agent.answers_incomplete", message: "Complete required answers first", retryable: false, context: {} } }, { status: 409 });
    application.state = "awaiting_approval";
    application.version += 1;
    application.updated_at = new Date().toISOString();
    application.latest_approval = { id: crypto.randomUUID(), status: "pending", content_digest: "sha256:mock-current-snapshot", created_at: application.updated_at };
    application.timeline.unshift({ id: crypto.randomUUID(), kind: "approval", title: "Approval requested", detail: "Final submission remains blocked until you approve this snapshot.", created_at: application.updated_at });
    return response(application);
  }

  if (resource[0] === "agent" && resource[1] === "applications" && resource[3] === "materials") {
    const application = applicationById(resource[2]);
    if (!application || !["preparing", "needs_attention"].includes(application.state)) return unavailable();
    application.resume_version = 1; application.ats_score = 86; application.version += 1;
    application.updated_at = new Date().toISOString();
    return response(application);
  }

  if (resource[0] === "agent" && resource[1] === "approvals" && resource[3] === "decision") {
    const application = store().find((item) => item.latest_approval?.id === resource[2]);
    if (!application?.latest_approval) return unavailable();
    if (body.expected_version !== application.version) return NextResponse.json({ detail: { code: "agent.invalid_state_transition", message: "Application version is stale", retryable: true, context: {} } }, { status: 409 });
    application.latest_approval.status = body.decision;
    application.latest_approval.decided_at = new Date().toISOString();
    application.state = body.decision === "approved" ? "approved" : "rejected";
    application.version += 1;
    application.updated_at = application.latest_approval.decided_at;
    application.timeline.unshift({ id: crypto.randomUUID(), kind: "approval", title: body.decision === "approved" ? "Content approved" : "Application rejected", detail: body.decision === "approved" ? "Approval recorded. OpenClaw may fill, but submission still requires the server-side queued receipt guard." : "No external action will be taken.", created_at: application.updated_at });
    return response(application);
  }
  if (resource[0] === "agent" && resource[1] === "applications" && resource[3] === "submissions") {
    const application = applicationById(resource[2]);
    if (!application || application.state !== "approved" || application.latest_approval?.status !== "approved") return NextResponse.json({ detail: { code: "agent.approval_required", message: "A current human approval is required", retryable: false, context: {} } }, { status: 409 });
    application.state = "submitting";
    application.version += 1;
    application.updated_at = new Date().toISOString();
    application.latest_receipt = { id: crypto.randomUUID(), status: "queued", provider: body.provider, created_at: application.updated_at, updated_at: application.updated_at };
    application.timeline.unshift({ id: crypto.randomUUID(), kind: "submission", title: "Simulated submission queued", detail: "The local mock created a receipt. No employer or external recruiting site was contacted.", created_at: application.updated_at });
    return response(application);
  }
  return unavailable();
}
