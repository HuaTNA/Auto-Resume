import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { DiscordBridge } from "./bridge.js";
import { AutoResumeApiClient } from "./client.js";
import { parseCommand } from "./command_parser.js";
import { parseSnowflakeAllowlist, trustedDiscordContext } from "./identity.js";
import type { ParsedCommand } from "./types.js";

const UUID = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
const SNOWFLAKE = "^[0-9]{15,22}$";
const messageContext = {
  discordMessageId: Type.String({ pattern: SNOWFLAKE, description: "Original inbound Discord message ID; mandatory idempotency source, never generate a replacement." }),
};

const configSchema = Type.Object({
  baseUrl: Type.String({ format: "uri", description: "AUTO_RESUME_API_URL" }),
  serviceToken: Type.String({ minLength: 1, description: "AUTO_RESUME_SERVICE_TOKEN via environment/Secret Store; never expose it." }),
  allowedUserIds: Type.String({ minLength: 15, description: "DISCORD_ALLOWED_USER_IDS (comma-separated snowflakes)." }),
  allowedChannelIds: Type.String({ minLength: 15, description: "DISCORD_ALLOWED_CHANNEL_IDS (comma-separated snowflakes)." }),
  requestTimeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 30000, default: 10000 })),
}, { additionalProperties: false });

const resultSchema = Type.Object({ ok: Type.Literal(true), targetType: Type.Union([Type.Literal("digest"), Type.Literal("approval")]), targetId: Type.String({ pattern: UUID }), message: Type.String() }, { additionalProperties: false });

function createBridge(config: any): DiscordBridge {
  return new DiscordBridge(
    new AutoResumeApiClient({ baseUrl: config.baseUrl, serviceToken: config.serviceToken, requestTimeoutMs: config.requestTimeoutMs }),
    { allowedUserIds: parseSnowflakeAllowlist(config.allowedUserIds, "DISCORD_ALLOWED_USER_IDS"), allowedChannelIds: parseSnowflakeAllowlist(config.allowedChannelIds, "DISCORD_ALLOWED_CHANNEL_IDS") },
  );
}

export default defineToolPlugin({
  id: "auto-resume-discord-bridge", name: "Auto Resume Discord Bridge",
  description: "Contract-v1 scoped, idempotent Auto Resume recommendation and approval tools for trusted Discord requesters.", configSchema,
  tools: (tool: any) => {
    const bound = (definition: any, command: (params: any) => ParsedCommand) => tool({
      ...definition,
      factory({ toolContext, config }: any) {
        // Tool visibility is bound to OpenClaw's trusted inbound context, not to model arguments.
        if (!trustedDiscordContext(toolContext, "000000000000000")) return null;
        return {
          ...definition,
          async execute(_toolCallId: string, params: any) {
            const context = trustedDiscordContext(toolContext, params.discordMessageId);
            if (!context) throw new Error("此工具只能由带受信任 sender/channel context 的 Discord 消息调用");
            const result = await createBridge(config).execute(command(params), context);
            return { content: [{ type: "text", text: result.message }], details: result };
          },
        };
      },
    });

    return [
      bound({ name: "auto_resume_discord_command", label: "Run Discord command", optional: true,
        description: "Parse a Chinese command that names an exact digest or approval public UUID.",
        parameters: Type.Object({ ...messageContext, command: Type.String({ minLength: 1, maxLength: 2200 }) }, { additionalProperties: false }), outputSchema: resultSchema },
      (params) => parseCommand(params.command)),
      bound({ name: "auto_resume_bind_discord", label: "Authorize Discord identity", optional: true,
        description: "Validate OpenClaw's trusted Discord requester/channel against deployment allowlists and associate this command with one approval. Does not mutate Auto-Resume state.",
        parameters: Type.Object({ ...messageContext, approvalId: Type.String({ pattern: UUID }) }, { additionalProperties: false }), outputSchema: resultSchema },
      (params) => ({ kind: "bind", approvalId: params.approvalId })),
      bound({ name: "auto_resume_get_latest_digest", label: "Get latest A/B/C recommendations",
        description: "GET the latest ready recommendation batch for the trusted bound Discord user.",
        parameters: Type.Object({ ...messageContext }, { additionalProperties: false }), outputSchema: resultSchema },
      () => ({ kind: "latest_digest" })),
      bound({ name: "auto_resume_get_digest", label: "Get A/B/C recommendations",
        description: "GET one Contract V1 recommendation batch and render its first three ordered items as A/B/C.",
        parameters: Type.Object({ ...messageContext, digestId: Type.String({ pattern: UUID }) }, { additionalProperties: false }), outputSchema: resultSchema },
      (params) => ({ kind: "digest", digestId: params.digestId })),
      bound({ name: "auto_resume_select_recommendation", label: "Select A/B/C recommendation", optional: true,
        description: "Resolve A/B/C, start the agent, and idempotently generate a resume with at most two ATS optimization rounds.",
        parameters: Type.Object({ ...messageContext, digestId: Type.String({ pattern: UUID }), choice: Type.Union([Type.Literal("A"), Type.Literal("B"), Type.Literal("C")]) }, { additionalProperties: false }), outputSchema: resultSchema },
      (params) => ({ kind: "select", digestId: params.digestId, choice: params.choice })),
      bound({ name: "auto_resume_decide_approval", label: "Decide approval", optional: true,
        description: "Approve or reject one exact approval with optimistic concurrency. Never submits an external application.",
        parameters: Type.Object({ ...messageContext, approvalId: Type.String({ pattern: UUID }), agentId: Type.String({ pattern: UUID }), expectedVersion: Type.Integer({ minimum: 1, description: "Current Agent version, not approval-record version." }), decision: Type.Union([Type.Literal("approved"), Type.Literal("rejected")]), note: Type.Optional(Type.String({ maxLength: 2000 })) }, { additionalProperties: false }), outputSchema: resultSchema },
      (params) => ({ kind: "decision", approvalId: params.approvalId, agentId: params.agentId, expectedVersion: params.expectedVersion, decision: params.decision, note: params.note })),
      bound({ name: "auto_resume_get_status", label: "Get digest/approval status",
        description: "Read a digest, or read an agent and verify its latest approval matches the requested approval ID.",
        parameters: Type.Object({ ...messageContext, targetType: Type.Union([Type.Literal("digest"), Type.Literal("approval")]), targetId: Type.String({ pattern: UUID }), agentId: Type.Optional(Type.String({ pattern: UUID, description: "Required for approval because Contract V1 has no GET approval endpoint." })) }, { additionalProperties: false }), outputSchema: resultSchema },
      (params) => params.targetType === "digest" ? { kind: "digest_status", digestId: params.targetId } : (() => { if (!params.agentId) throw new Error("approval 状态查询需要 agentId"); return { kind: "approval_status", approvalId: params.targetId, agentId: params.agentId }; })()),
    ];
  },
});
