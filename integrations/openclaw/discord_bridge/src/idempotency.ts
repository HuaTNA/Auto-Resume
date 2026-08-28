import { createHash } from "node:crypto";
import type { DiscordContext, ParsedCommand } from "./types.js";

function target(command: ParsedCommand): string {
  if (command.kind === "latest_digest") return "latest";
  if ("digestId" in command) return `digest:${command.digestId}`;
  return `approval:${command.approvalId}`;
}

export function commandIdempotencyKey(command: ParsedCommand, context: DiscordContext): string {
  const material = [context.discordUserId, context.discordChannelId, context.discordMessageId, command.kind, target(command)].join(":");
  return `discord-${createHash("sha256").update(material).digest("hex")}`;
}
