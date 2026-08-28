import type { ParsedCommand } from "./types.js";

const PUBLIC_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CommandParseError extends Error {
  constructor(message: string) { super(message); this.name = "CommandParseError"; }
}

function parts(input: string): string[] {
  return input.trim().replace(/^<@!?\d+>\s*/, "").replace(/^[!/／]\s*/, "").split(/\s+/u).filter(Boolean);
}

function publicId(raw: string | undefined, label: string): string {
  if (!raw || !PUBLIC_ID_RE.test(raw)) throw new CommandParseError(`${label} 必须是 public UUID`);
  return raw.toLowerCase();
}

function version(raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new CommandParseError("agent version 必须是正整数");
  return value;
}

export function parseCommand(input: string): ParsedCommand {
  const tokens = parts(input);
  const verb = (tokens.shift() ?? "").toLowerCase();
  if (["绑定", "bind"].includes(verb)) {
    const approvalId = publicId(tokens.shift(), "approval ID");
    if (tokens.length) throw new CommandParseError("用法：绑定 <approval ID>");
    return { kind: "bind", approvalId };
  }
  if (["推荐", "digest"].includes(verb)) {
    if (!tokens.length || tokens[0]?.toLowerCase() === "latest" || tokens[0] === "最新") {
      if (tokens.length > 1) throw new CommandParseError("用法：推荐 [最新|digest ID]");
      return { kind: "latest_digest" };
    }
    const digestId = publicId(tokens.shift(), "digest ID");
    if (tokens.length) throw new CommandParseError("用法：推荐 <digest ID>");
    return { kind: "digest", digestId };
  }
  if (["选择", "select"].includes(verb)) {
    const digestId = publicId(tokens.shift(), "digest ID");
    const choice = (tokens.shift() ?? "").toUpperCase();
    if (!(["A", "B", "C"] as string[]).includes(choice) || tokens.length) throw new CommandParseError("用法：选择 <digest ID> <A|B|C>");
    return { kind: "select", digestId, choice: choice as "A" | "B" | "C" };
  }
  if (["批准", "同意", "approve", "拒绝", "reject"].includes(verb)) {
    const approvalId = publicId(tokens.shift(), "approval ID");
    const agentId = publicId(tokens.shift(), "agent ID");
    const expectedVersion = version(tokens.shift());
    const note = tokens.join(" ").trim() || undefined;
    if (note && note.length > 2000) throw new CommandParseError("审批备注不能超过 2000 字符");
    return { kind: "decision", approvalId, agentId, expectedVersion, decision: ["批准", "同意", "approve"].includes(verb) ? "approved" : "rejected", note };
  }
  if (["状态", "status"].includes(verb)) {
    const type = (tokens.shift() ?? "").toLowerCase();
    if (["digest", "摘要"].includes(type)) {
      const digestId = publicId(tokens.shift(), "digest ID");
      if (tokens.length) throw new CommandParseError("用法：状态 digest <digest ID>");
      return { kind: "digest_status", digestId };
    }
    if (["approval", "审批"].includes(type)) {
      const approvalId = publicId(tokens.shift(), "approval ID");
      const agentId = publicId(tokens.shift(), "agent ID");
      if (tokens.length) throw new CommandParseError("用法：状态 approval <approval ID> <agent ID>");
      return { kind: "approval_status", approvalId, agentId };
    }
    throw new CommandParseError("状态命令必须指定 digest/摘要 或 approval/审批");
  }
  throw new CommandParseError("支持：绑定 <approval ID>；推荐 [最新|digest ID]；选择 <digest ID> <A|B|C>；批准/拒绝 <approval ID> <agent ID> <version>；状态 digest <ID>；状态 approval <approval ID> <agent ID>");
}
