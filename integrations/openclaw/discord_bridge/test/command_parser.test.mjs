import test from "node:test";
import assert from "node:assert/strict";
import { CommandParseError, parseCommand } from "../dist/command_parser.js";

const DIGEST = "11111111-1111-4111-8111-111111111111";
const APPROVAL = "22222222-2222-4222-8222-222222222222";
const AGENT = "33333333-3333-4333-8333-333333333333";

test("parses the Chinese command matrix with public UUIDs", () => {
  assert.deepEqual(parseCommand("推荐"), { kind: "latest_digest" });
  assert.deepEqual(parseCommand("推荐 最新"), { kind: "latest_digest" });
  assert.deepEqual(parseCommand(`推荐 ${DIGEST}`), { kind: "digest", digestId: DIGEST });
  assert.deepEqual(parseCommand(`选择 ${DIGEST} b`), { kind: "select", digestId: DIGEST, choice: "B" });
  assert.deepEqual(parseCommand(`批准 ${APPROVAL} ${AGENT} 3 已人工核对`), { kind: "decision", approvalId: APPROVAL, agentId: AGENT, expectedVersion: 3, decision: "approved", note: "已人工核对" });
  assert.deepEqual(parseCommand(`拒绝 ${APPROVAL} ${AGENT} 4 信息不准确`), { kind: "decision", approvalId: APPROVAL, agentId: AGENT, expectedVersion: 4, decision: "rejected", note: "信息不准确" });
  assert.deepEqual(parseCommand(`状态 digest ${DIGEST}`), { kind: "digest_status", digestId: DIGEST });
  assert.deepEqual(parseCommand(`状态 approval ${APPROVAL} ${AGENT}`), { kind: "approval_status", approvalId: APPROVAL, agentId: AGENT });
  assert.deepEqual(parseCommand(`绑定 ${APPROVAL}`), { kind: "bind", approvalId: APPROVAL });
});

test("strips a trusted-adapter mention/slash prefix but never parses identity from it", () => {
  assert.deepEqual(parseCommand(`<@123456789012345678> /推荐 ${DIGEST}`), { kind: "digest", digestId: DIGEST });
});

test("rejects database IDs, missing versions, and unscoped commands", () => {
  for (const input of ["推荐 42", `批准 ${APPROVAL}`, `批准 ${APPROVAL} ${AGENT}`, `选择 ${DIGEST} D`, `状态 approval ${APPROVAL}`, "帮助"]) {
    assert.throws(() => parseCommand(input), CommandParseError, input);
  }
});
