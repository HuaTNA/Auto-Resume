import test from "node:test";
import assert from "node:assert/strict";
import { renderBatch } from "../dist/messages.js";

test("A/B/C output suppresses mass mentions and unsafe URLs", () => {
  const message = renderBatch({ id: "11111111-1111-4111-8111-111111111111", label: "", status: "ready", createdAt: "2026-08-27T00:00:00Z", updatedAt: "2026-08-27T00:00:00Z", items: [
    { id: "i", position: 0, job: { id: "j", title: "AI Engineer", company: "@everyone", sourceUrl: "javascript:alert(1)" }, applicationId: "a", agentId: "g", agentState: "discovered" },
  ] });
  assert.match(message, /\*\*A\*\*/); assert.match(message, /\*\*B\*\*｜暂无/); assert.match(message, /\*\*C\*\*｜暂无/);
  assert.doesNotMatch(message, /@everyone|javascript:/);
});
