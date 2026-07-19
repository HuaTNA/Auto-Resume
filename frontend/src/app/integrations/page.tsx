"use client";

import { useEffect, useState } from "react";
import Header from "@/components/Header";
import { Section, StatusPill, WorkspacePage } from "@/components/workspace/WorkspaceUI";
import { connectIntegration, disconnectIntegration, listIntegrations, PlatformIntegration } from "@/lib/platform-api";
import { useLanguage } from "@/lib/language-context";

const PROVIDERS = [
  { id: "notion", name: "Notion", scopes: ["read:selected", "write:selected"] },
  { id: "calendar", name: "Calendar", scopes: ["read:events"] },
  { id: "browser-capture", name: "Browser Capture", scopes: ["write:knowledge"] },
];

export default function IntegrationsPage() {
  const { text } = useLanguage(); const [items, setItems] = useState<PlatformIntegration[]>([]); const [busy, setBusy] = useState(""); const [error, setError] = useState("");
  async function load() { try { setItems((await listIntegrations()).integrations); setError(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "Integrations could not be loaded"); } }
  useEffect(() => { void load(); }, []);
  async function toggle(provider: typeof PROVIDERS[number]) { const existing = items.find((item) => item.provider === provider.id); setBusy(provider.id); try { if (existing) await disconnectIntegration(provider.id); else await connectIntegration(provider.id, { scopes: provider.scopes }); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Connection could not be updated"); } finally { setBusy(""); } }
  return <><Header eyebrow={{ zh: "连接工作区", en: "CONNECTED WORKSPACE" }} title={{ zh: "集成", en: "Integrations" }} subtitle={{ zh: "集中记录外部连接、权限范围与连接状态。", en: "Keep external connections, scopes, and status in one place." }} /><WorkspacePage>
    {error && <p className="rounded-[12px] bg-[#EBE2CC] p-4 text-xs">{error}</p>}
    <Section title={text("连接注册表", "Connection registry")}>
      <p className="mb-5 text-xs leading-6 text-[#7A6A50]">{text("当前阶段保存每位用户的连接状态和权限范围；实际 OAuth 同步仍需要对应 Provider 凭证。", "This stage stores per-user connection state and scopes; provider credentials are still required for live OAuth sync.")}</p><div className="grid gap-4 md:grid-cols-3">{PROVIDERS.map((provider) => { const existing = items.find((item) => item.provider === provider.id); return <article key={provider.id} className="rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-5"><div className="flex items-center justify-between"><StatusPill tone={existing ? "brand" : "neutral"}>{existing ? text("已登记", "Registered") : text("未连接", "Disconnected")}</StatusPill></div><h3 className="mt-5 text-sm font-medium">{provider.name}</h3><div className="mt-3 flex flex-wrap gap-1.5">{provider.scopes.map((scope) => <span key={scope} className="rounded-[6px] bg-[#EBE2CC] px-2 py-1 text-[9px]">{scope}</span>)}</div><button onClick={() => toggle(provider)} disabled={busy === provider.id} className="secondary-button mt-5 disabled:opacity-50">{busy === provider.id ? text("更新中…", "Updating…") : existing ? text("移除登记", "Remove") : text("登记连接", "Register")}</button></article>; })}</div>
    </Section>
    <p className="rounded-[12px] bg-[#EBE2CC] p-4 text-xs leading-6 text-[#7A6A50]">{text("敏感访问令牌不会通过这个界面写入数据库；正式 OAuth 接入时应只保存加密凭证引用。", "Sensitive access tokens are not written through this interface; live OAuth should store only encrypted credential references.")}</p>
  </WorkspacePage></>;
}
