import type { DiscordContext } from "./types.js";

export interface DiscordAllowlist {
  allowedUserIds: readonly string[];
  allowedChannelIds: readonly string[];
}

export class DiscordAuthorizationError extends Error {
  constructor() { super("此 Discord 身份或频道未获授权"); this.name = "DiscordAuthorizationError"; }
}

export function parseSnowflakeAllowlist(value: string, name: string): string[] {
  const ids = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
  if (!ids.length || ids.some((id) => !/^[0-9]{15,22}$/.test(id))) throw new Error(`${name} 必须是逗号分隔的 Discord snowflake ID`);
  return ids;
}

export function authorizeDiscordContext(context: DiscordContext, allowlist: DiscordAllowlist): void {
  if (
    !allowlist.allowedUserIds.includes(context.discordUserId) ||
    !allowlist.allowedChannelIds.includes(context.discordChannelId)
  ) throw new DiscordAuthorizationError();
}

export function trustedDiscordContext(toolContext: any, discordMessageId: string): DiscordContext | undefined {
  if (toolContext.messageChannel !== "discord" || !toolContext.requesterSenderId) return undefined;
  const target = String(toolContext.deliveryContext?.to ?? "");
  const channelId = target.match(/[0-9]{15,22}/g)?.at(-1);
  if (!channelId) return undefined;
  return { discordUserId: toolContext.requesterSenderId, discordChannelId: channelId, discordMessageId };
}
