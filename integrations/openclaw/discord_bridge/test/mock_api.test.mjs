import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { DiscordBridge } from "../dist/bridge.js";
import { AgentApiError, AutoResumeApiClient } from "../dist/client.js";
import { authorizeDiscordContext, DiscordAuthorizationError, trustedDiscordContext } from "../dist/identity.js";

const DIGEST = "11111111-1111-4111-8111-111111111111";
const APPROVAL = "22222222-2222-4222-8222-222222222222";
const AGENT = "33333333-3333-4333-8333-333333333333";
const ITEM_A = "44444444-4444-4444-8444-444444444444";
const APP = "55555555-5555-4555-8555-555555555555";
const JOB = "66666666-6666-4666-8666-666666666666";
const IDS = { discordUserId: "123456789012345678", discordChannelId: "323456789012345678", discordMessageId: "423456789012345678" };
const allowlist = { allowedUserIds: [IDS.discordUserId], allowedChannelIds: [IDS.discordChannelId] };

const batch = { id: DIGEST, label: "daily", status: "ready", items: [{ id: ITEM_A, position: 0, job: { id: JOB, title: "AI Engineer", company: "Acme", location: "Toronto", source: "greenhouse", source_url: "https://jobs.example/a" }, application_id: APP, agent_id: AGENT, agent_state: "discovered" }], created_at: "2026-08-27T12:00:00", updated_at: "2026-08-27T12:00:00" };
const approval = { id: APPROVAL, status: "approved", content_digest: "sha256-safe", version: 2, requested_note: "", decision_note: "", decided_at: "2026-08-27T12:02:00", created_at: "2026-08-27T12:00:00", updated_at: "2026-08-27T12:02:00" };
const agent = (state = "discovered", version = 1, atsScore = null) => ({ id: AGENT, application_id: APP, state, version, ats_score: atsScore, ats_rounds: atsScore == null ? 0 : 1, resume_version: atsScore == null ? null : 2, last_error: null, answers: [], latest_approval: state === "approved" ? approval : null, latest_receipt: null, created_at: "2026-08-27T12:00:00", updated_at: "2026-08-27T12:02:00" });

async function mockServer(handler) {
  const calls = [];
  const server = http.createServer(async (request, response) => {
    let body = ""; for await (const chunk of request) body += chunk;
    calls.push({ method: request.method, url: request.url, headers: request.headers, body: body ? JSON.parse(body) : undefined });
    const result = await handler(calls.at(-1)); response.writeHead(result.status ?? 200, { "content-type": "application/json", ...(result.headers ?? {}) }); response.end(JSON.stringify(result.body));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  return { calls, close: () => new Promise((resolve) => server.close(resolve)), baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function client(baseUrl) { return new AutoResumeApiClient({ baseUrl, serviceToken: "fake-test-service-token" }); }

test("Discord 推荐 input maps to Contract V1 GET batch with identity and idempotency headers", async (t) => {
  const mock = await mockServer(async () => ({ body: batch })); t.after(mock.close);
  const bridge = new DiscordBridge(client(mock.baseUrl), allowlist);
  const result = await bridge.execute({ kind: "digest", digestId: DIGEST }, IDS);
  assert.equal(mock.calls[0].url, `/api/agent/recommendation-batches/${DIGEST}`);
  assert.match(mock.calls[0].headers.authorization, /^Bearer /);
  assert.equal(mock.calls[0].headers["x-discord-message-id"], IDS.discordMessageId);
  assert.match(mock.calls[0].headers["idempotency-key"], /^discord-[a-f0-9]{64}$/);
  assert.match(result.message, /\*\*A\*\*｜AI Engineer/);
});

test("Discord 推荐 latest resolves the newest ready batch for the bound user", async (t) => {
  const mock = await mockServer(async () => ({ body: batch })); t.after(mock.close);
  const bridge = new DiscordBridge(client(mock.baseUrl), allowlist);
  const result = await bridge.execute({ kind: "latest_digest" }, IDS);
  assert.equal(mock.calls[0].url, "/api/agent/recommendation-batches/latest");
  assert.equal(result.targetId, DIGEST);
  assert.match(result.message, /Digest/);
});

test("Discord 选择 A starts the agent and prepares bounded ATS materials", async (t) => {
  const mock = await mockServer(async (call) => {
    if (call.url.includes("recommendation-batches")) return { body: batch };
    if (call.method === "GET") return { body: { agent: agent() } };
    if (call.url.endsWith("/materials")) return { body: { agent: agent("preparing", 2, 86) } };
    if (call.body?.action === "request_approval") return { body: { agent: { ...agent("awaiting_approval", 3, 86), latest_approval: { ...approval, status: "pending", version: 1, decided_at: null } } } };
    return { body: { agent: agent("preparing", 2) } };
  }); t.after(mock.close);
  const bridge = new DiscordBridge(client(mock.baseUrl), allowlist);
  const result = await bridge.execute({ kind: "select", digestId: DIGEST, choice: "A" }, IDS);
  assert.deepEqual(mock.calls.map(({ method, url }) => [method, url]), [
    ["GET", `/api/agent/recommendation-batches/${DIGEST}`], ["GET", `/api/agent/applications/${AGENT}`], ["POST", `/api/agent/applications/${AGENT}/transitions`], ["POST", `/api/agent/applications/${AGENT}/materials`], ["POST", `/api/agent/applications/${AGENT}/transitions`],
  ]);
  assert.deepEqual(mock.calls[2].body, { action: "start", expected_version: 1, reason: "Selected from Discord recommendation digest" });
  assert.equal(mock.calls[3].body.max_optimization_rounds, 2);
  assert.equal(mock.calls[4].body.action, "request_approval");
  assert.match(result.message, /ATS：86\/100/);
  assert.match(result.message, /待审批/);
});

test("Discord approval maps exactly to decision endpoint and frozen enum", async (t) => {
  const pending = { ...approval, status: "pending", version: 1, decided_at: null };
  const pendingAgent = { ...agent("awaiting_approval", 2), latest_approval: pending };
  const mock = await mockServer(async (call) => call.method === "GET" ? { body: { agent: pendingAgent } } : { body: { approval, agent: agent("approved", 3) } }); t.after(mock.close);
  const bridge = new DiscordBridge(client(mock.baseUrl), allowlist);
  await bridge.execute({ kind: "decision", approvalId: APPROVAL, agentId: AGENT, expectedVersion: 2, decision: "approved", note: "reviewed" }, IDS);
  assert.equal(mock.calls[0].url, `/api/agent/applications/${AGENT}`);
  assert.equal(mock.calls[1].url, `/api/agent/approvals/${APPROVAL}/decision`);
  assert.deepEqual(mock.calls[1].body, { decision: "approved", expected_version: 2, note: "reviewed" });
});

test("replayed completed approval performs no second write", async (t) => {
  const mock = await mockServer(async () => ({ body: { agent: agent("approved", 3) } })); t.after(mock.close);
  const bridge = new DiscordBridge(client(mock.baseUrl), allowlist);
  const result = await bridge.execute({ kind: "decision", approvalId: APPROVAL, agentId: AGENT, expectedVersion: 1, decision: "approved" }, IDS);
  assert.equal(mock.calls.length, 1); assert.equal(mock.calls[0].method, "GET"); assert.match(result.message, /approved/);
});

test("approval status verifies latest approval ID through agent GET", async (t) => {
  const mock = await mockServer(async () => ({ body: { agent: agent("approved", 3) } })); t.after(mock.close);
  const bridge = new DiscordBridge(client(mock.baseUrl), allowlist);
  const result = await bridge.execute({ kind: "approval_status", approvalId: APPROVAL, agentId: AGENT }, IDS);
  assert.match(result.message, /approved/);
  await assert.rejects(() => bridge.execute({ kind: "approval_status", approvalId: DIGEST, agentId: AGENT }, { ...IDS, discordMessageId: "523456789012345678" }), /不一致/);
});

test("allowlists reject unknown trusted Discord user/channel before HTTP", () => {
  assert.throws(() => authorizeDiscordContext({ ...IDS, discordUserId: "999999999999999999" }, allowlist), DiscordAuthorizationError);
});

test("trusted context comes from OpenClaw factory metadata, not model identity fields", () => {
  assert.deepEqual(trustedDiscordContext({ messageChannel: "discord", requesterSenderId: IDS.discordUserId, deliveryContext: { to: `channel:${IDS.discordChannelId}` } }, IDS.discordMessageId), IDS);
  assert.equal(trustedDiscordContext({ messageChannel: "web", requesterSenderId: IDS.discordUserId, deliveryContext: { to: IDS.discordChannelId } }, IDS.discordMessageId), undefined);
});

test("structured API errors expose only stable code, not secret-bearing response fields", async (t) => {
  const mock = await mockServer(async () => ({ status: 409, body: { detail: { code: "agent.idempotency_conflict", message: "token fake-secret must not leak", retryable: false, context: { token: "fake-secret" } } } })); t.after(mock.close);
  await assert.rejects(() => client(mock.baseUrl).getBatch(DIGEST, { ...IDS, idempotencyKey: "discord-test" }), (error) => error instanceof AgentApiError && error.code === "agent.idempotency_conflict" && !error.message.includes("fake-secret"));
});
