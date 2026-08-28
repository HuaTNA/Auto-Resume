import { AutoResumeApiClient } from "./client.js";
import { authorizeDiscordContext, type DiscordAllowlist } from "./identity.js";
import { commandIdempotencyKey } from "./idempotency.js";
import { choiceItem, renderApproval, renderApprovalStatus, renderBatch, renderSelection } from "./messages.js";
import type { BridgeResult, DiscordContext, ParsedCommand } from "./types.js";

export class DiscordBridge {
  constructor(private readonly client: AutoResumeApiClient, private readonly allowlist: DiscordAllowlist) {}
  async execute(command: ParsedCommand, context: DiscordContext): Promise<BridgeResult> {
    authorizeDiscordContext(context, this.allowlist);
    const scope = { ...context, idempotencyKey: commandIdempotencyKey(command, context) };
    if (command.kind === "bind") return { ok: true, targetType: "approval", targetId: command.approvalId, message: `Discord 身份和当前 User/Guild/Channel 已获授权；关联 approval \`${command.approvalId}\`` };
    if (command.kind === "latest_digest") {
      const batch = await this.client.getLatestBatch(scope);
      return { ok: true, targetType: "digest", targetId: batch.id, message: renderBatch(batch) };
    }
    if (command.kind === "digest" || command.kind === "digest_status") {
      const batch = await this.client.getBatch(command.digestId, scope);
      return { ok: true, targetType: "digest", targetId: command.digestId, message: renderBatch(batch) };
    }
    if (command.kind === "select") {
      const batch = await this.client.getBatch(command.digestId, scope); const selected = choiceItem(batch, command.choice);
      let current = await this.client.getAgent(selected.agentId, scope);
      if (current.state === "discovered") {
        current = (await this.client.startAgent(selected.agentId, current.version, scope)).agent;
      }
      let response = current.state === "preparing" && current.atsScore == null
        ? await this.client.prepareMaterials(selected.agentId, scope)
        : { agent: current };
      if (response.agent.state === "preparing" && response.agent.atsScore != null) {
        response = await this.client.requestApproval(selected.agentId, response.agent.version, scope);
      }
      return { ok: true, targetType: "digest", targetId: command.digestId, message: renderSelection(command.choice, response) };
    }
    if (command.kind === "decision") {
      const current = await this.client.getAgent(command.agentId, scope);
      const latest = current.latestApproval;
      if (!latest || latest.id !== command.approvalId) throw new Error("该 agent 的 latest_approval 与指定 approval ID 不一致");
      if (latest.status === command.decision) {
        return { ok: true, targetType: "approval", targetId: command.approvalId, message: renderApprovalStatus(command.approvalId, current) };
      }
      if (latest.status !== "pending" || current.version !== command.expectedVersion) throw new Error("agent/approval 已变化；请重新查询状态后再决定");
      const response = await this.client.decideApproval(command.approvalId, command.decision, command.expectedVersion, command.note, scope);
      return { ok: true, targetType: "approval", targetId: command.approvalId, message: renderApproval(response) };
    }
    const current = await this.client.getAgent(command.agentId, scope);
    return { ok: true, targetType: "approval", targetId: command.approvalId, message: renderApprovalStatus(command.approvalId, current) };
  }
}
