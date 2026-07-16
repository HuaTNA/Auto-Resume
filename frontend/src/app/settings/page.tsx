"use client";

import Link from "next/link";
import Header from "@/components/Header";
import LanguageSwitch from "@/components/LanguageSwitch";
import { Section, WorkspacePage } from "@/components/workspace/WorkspaceUI";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/language-context";

export default function SettingsPage() {
  const { user } = useAuth(); const { text } = useLanguage();
  return <><Header eyebrow={{ zh: "工作区设置", en: "WORKSPACE SETTINGS" }} title={{ zh: "设置", en: "Settings" }} subtitle={{ zh: "管理账户、偏好、数据边界和外部连接。", en: "Manage account, preferences, data boundaries, and connections." }} /><WorkspacePage>
    <Section title={text("语言", "Language")} eyebrow={text("界面偏好", "Interface preference")}><div className="flex items-center justify-between gap-5 rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-5"><div><p className="text-sm font-medium tracking-[0.1em]">{text("界面语言", "Interface language")}</p><p className="mt-1 text-xs leading-5 text-[#7A6A50]">{text("选择会自动保存，并应用到整个工作区。", "Your choice is saved and applied across the workspace.")}</p></div><LanguageSwitch /></div></Section>
    <Section title={text("账户", "Account")} eyebrow={text("当前用户", "Current user")}><div className="rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-5"><p className="latin text-[10px] uppercase tracking-[0.28em] text-[#9A8468]">Email</p><p className="mt-2 text-sm">{user?.email}</p><p className="mt-4 text-xs leading-6 text-[#7A6A50]">{text("所有新建的 Project、Task 和 Knowledge 数据都绑定当前 user_id。", "Every new Project, Task, and Knowledge item is scoped to the current user_id.")}</p></div></Section>
    <Section title={text("工作区管理", "Workspace management")}><div className="grid gap-6 sm:grid-cols-2">{[{ href: "/profile", zh: "职业档案", en: "Career profile", detailZh: "管理职业经历和技能", detailEn: "Manage experience and skills" }, { href: "/integrations", zh: "集成与权限", en: "Integrations & permissions", detailZh: "连接外部工具并控制访问", detailEn: "Connect tools and control access" }].map((item) => <Link key={item.href} href={item.href} className="lift-card rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-5"><h3 className="text-sm font-medium tracking-[0.1em]">{text(item.zh, item.en)}</h3><p className="mt-2 text-xs text-[#7A6A50]">{text(item.detailZh, item.detailEn)}</p></Link>)}</div></Section>
    <div className="rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#EBE2CC] p-5"><p className="text-xs font-medium tracking-[0.1em] text-[#1E1A14]">{text("数据适配层", "Data adapter")}</p><p className="mt-2 text-xs leading-6 text-[#7A6A50]">{text("Projects、Tasks 和 Knowledge 当前使用逐用户浏览器存储，为 Supabase 表结构迁移保留了统一接口。Career 数据继续使用现有 FastAPI 数据库。", "Projects, Tasks, and Knowledge currently use per-user browser storage behind a shared adapter. Career data continues to use the existing FastAPI database while Supabase migration is prepared.")}</p></div>
  </WorkspacePage></>;
}
