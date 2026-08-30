"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/language-context";
import { connectIntegration, disconnectIntegration, PlatformIntegration } from "@/lib/platform-api";
import { StatusPill } from "./WorkspaceUI";

export default function DiscordBindingCard({ integration, ready, onChange }: {
  integration?: PlatformIntegration;
  ready: boolean;
  onChange: (integration?: PlatformIntegration) => void;
}) {
  const { text } = useLanguage();
  const [userId, setUserId] = useState(integration?.external_account ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const connected = integration?.state === "connected";

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = userId.trim();
    setError(""); setNotice("");
    if (!/^[0-9]{15,22}$/.test(value)) {
      setError(text("请输入 15–22 位纯数字的 Discord 用户 ID，不是用户名、服务器 ID 或频道 ID。", "Enter your 15–22 digit Discord user ID, not a username, server ID, or channel ID."));
      return;
    }
    setBusy(true);
    try {
      const result = await connectIntegration("discord", { external_account: value, scopes: ["agent:read", "agent:write"] });
      onChange(result.integration);
      setUserId(value);
      setNotice(text("绑定已保存。OpenClaw 还需配置相同的用户 ID 和允许使用的频道。", "Binding saved. OpenClaw must also allow this user ID and your Discord channel."));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text("绑定失败，请重试。", "Could not save the binding. Try again."));
    } finally { setBusy(false); }
  }

  async function disconnect() {
    setBusy(true); setError(""); setNotice("");
    try {
      await disconnectIntegration("discord");
      onChange(undefined);
      setUserId("");
      setNotice(text("已解绑。该 Discord 身份将无法再通过桥接访问此账户。", "Disconnected. This Discord identity can no longer access this account through the bridge."));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text("解绑失败，请重试。", "Could not disconnect. Try again."));
    } finally { setBusy(false); }
  }

  return <article data-testid="discord-binding" className="rounded-[16px] border border-[rgba(38,51,47,0.12)] bg-[#F8FAF8] p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-sm font-medium">Discord · OpenClaw</h3>
      <span data-testid="discord-binding-state"><StatusPill tone={connected ? "brand" : "neutral"}>{!ready ? text("等待加载", "Loading") : connected ? text("已绑定", "Bound") : text("未绑定", "Not bound")}</StatusPill></span>
    </div>
    <p className="mt-3 text-xs leading-6 text-[#52645C]">{text("将你自己的 Discord 身份关联到当前网站账户，让已配置的 OpenClaw 桥接读取岗位推荐并处理你的指令。此处只保存用户 ID，不需要 Bot Token 或服务密钥。", "Link your own Discord identity to this website account so your configured OpenClaw bridge can read recommendations and process your instructions. Only a user ID is needed here, never a bot token or service secret.")}</p>
    {connected && <p className="mt-3 break-all text-xs" data-testid="discord-bound-id">{text("当前绑定：", "Bound ID: ")}{integration.external_account}</p>}
    <form onSubmit={save} noValidate className="mt-5 space-y-3">
      <label htmlFor="discord-user-id" className="block text-xs">{text("Discord 用户 ID", "Discord user ID")}</label>
      <input id="discord-user-id" data-testid="discord-user-id" type="text" inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={22} value={userId} onChange={(event) => setUserId(event.target.value)} disabled={!ready || busy || connected} aria-describedby="discord-id-help" aria-invalid={!!error} placeholder={text("粘贴你的数字用户 ID", "Paste your numeric user ID")} className="w-full rounded-[10px] border border-[rgba(38,51,47,0.12)] bg-[#FCFDFB] p-3 text-sm disabled:opacity-50" />
      <p id="discord-id-help" className="text-xs leading-6 text-[#52645C]">{text("在 Discord「设置 → 高级」开启开发者模式，再从自己的个人资料菜单复制用户 ID。绑定不是 Discord OAuth 身份认证；请只填写自己的 ID。更换 ID 前请先解绑。", "Enable Developer Mode in Discord Settings → Advanced, then copy your user ID from your profile menu. This binding is not Discord OAuth identity verification; only enter your own ID. Disconnect first to change IDs.")}</p>
      <div className="flex flex-wrap gap-3">
        {connected ? <button type="button" data-testid="discord-disconnect" disabled={!ready || busy} onClick={() => void disconnect()} className="secondary-button disabled:opacity-50">{busy ? text("解绑中…", "Disconnecting…") : text("解绑 Discord", "Disconnect Discord")}</button> : <button type="submit" data-testid="discord-connect" disabled={!ready || busy} className="primary-button disabled:opacity-50">{busy ? text("保存中…", "Saving…") : text("绑定 Discord", "Bind Discord")}</button>}
      </div>
    </form>
    {error && <p role="alert" className="mt-3 text-xs leading-6">{error}</p>}
    {notice && <p role="status" className="mt-3 text-xs leading-6">{notice}</p>}
  </article>;
}
