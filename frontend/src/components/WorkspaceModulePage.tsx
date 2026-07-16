"use client";

import Link from "next/link";
import Header from "@/components/Header";
import { BirchIcon, type BirchIconName } from "./icons/BirchIcons";
import { useLanguage } from "@/lib/language-context";

export interface WorkspaceModuleFeature { icon: string; title: string; description: string; status: "Active" | "Foundation" | "Planned" }
interface Props { eyebrow: string; title: string; subtitle: string; icon: string; statement: string; features: WorkspaceModuleFeature[]; nextSteps: string[]; action?: { href: string; label: string } }

const ICONS: BirchIconName[] = ["leaf", "growth-ring", "catkin"];
const HERO_ICONS: Record<string, BirchIconName> = { auto_awesome: "leaf", local_library: "growth-ring", account_tree: "catkin", hub: "grove" };
const STATUS_LABELS = { Active: { zh: "已启用", en: "ACTIVE" }, Foundation: { zh: "构建中", en: "FOUNDATION" }, Planned: { zh: "待生长", en: "PLANNED" } };
const ZH: Record<string, string> = {
  "AI Copilot": "桦笺",
  "Knowledge": "积识",
  "Automations": "例行",
  "Integrations": "联结",
  "Workspace intelligence": "工作台智能",
  "Workspace memory": "工作台记忆",
  "Workspace operations": "工作台例行",
  "Connected workspace": "联结工作台",
  "One assistant that can understand and work across every module.": "一位理解整个工作台语境的协作助手。",
  "Reusable context for AI, documents, decisions, and future modules.": "供智能、文书、决策与未来模块复用的语境。",
  "Scheduled and repeatable work with visible control.": "可安排、可复用，也始终可见可控的工作。",
  "Bring external tools into Personal OS without surrendering the source of truth.": "联结外部工具，同时保留工作台作为事实来源。",
  "AI should understand your workspace, not just one prompt.": "智能应理解你的工作台，而不只是一个提示词。",
  "Your knowledge should become an asset the whole workspace can use.": "让你的知识成为整个工作台都能使用的资产。",
  "Automation belongs inside your workspace—not hidden on one laptop.": "例行工作应安放在工作台中，而不是藏在一台电脑里。",
  "Connect the tools you use while keeping your workspace in control.": "联结日常工具，同时让工作台保有边界与掌控。",
  "Shared context": "共享语境", "Create and transform": "创作与转化", "Safe actions": "安全行动",
  "Structured profile": "结构化履历", "Files and sources": "文件与来源", "Reusable context": "可复用语境",
  "Career workflows": "职业流程", "Schedules": "安排", "Execution history": "执行记录",
  "Notion": "Notion", "Email and calendar": "邮件与日历", "Browser capture": "浏览器采集",
  "Open knowledge": "打开积识", "Open career profile": "打开职业履历", "View integrations": "查看联结",
  "Reason across your profile, documents, projects, jobs, and connected tools.": "跨履历、文书、项目、职位与联结工具理解语境。",
  "Draft, compare, summarize, and refine work without losing its source context.": "在不失去来源语境的前提下起草、比较、摘要与精修。",
  "Run approved workflows with clear previews, logs, and human review before external changes.": "以清楚的预览、记录与人工复核运行获准流程。",
  "Experience, projects, skills, and reusable evidence already power the Career module.": "经历、项目、技能与可复用证据已为职业模块提供支持。",
  "Organize uploaded files, generated documents, links, and source metadata in one library.": "在一处整理上传文件、生成文书、链接与来源信息。",
  "Tag notes, decisions, achievements, and facts so any module can retrieve them safely.": "标记笔记、决策、成果与事实，供各模块安全取用。",
  "The existing job search automation becomes the first managed workflow in this module.": "现有寻职自动化将成为此模块首个受管理流程。",
  "Run workflows on demand or on a clear schedule without depending on a local computer.": "按需或按明确安排运行流程，不依赖单一本地设备。",
  "Inspect retries, failures, processed items, duration, and AI cost for every run.": "查看每次运行的重试、失败、处理项、耗时与智能成本。",
  "Publish selected jobs and application status outward through one-way synchronization.": "通过单向同步，将选定职位与申请状态发布至外部。",
  "Turn messages, follow-ups, interviews, and reminders into workspace context.": "将消息、跟进、面谈与提醒转化为工作台语境。",
  "Save visible information from the web without exposing private API or database keys.": "采集网页可见信息，而不暴露私有 API 或数据库密钥。",
  "Create a workspace-wide AI conversation model": "建立覆盖全工作台的智能对话模型",
  "Add retrieval across structured data and documents": "加入跨结构化数据与文书的检索",
  "Define action permissions and confirmation boundaries": "定义行动权限与确认边界",
  "Track model usage, cost, and generated artifacts": "记录模型用量、成本与生成成果",
  "Unify profile data and experience bullets in Supabase": "在 Supabase 中统一履历数据与经历要点",
  "Add general documents and metadata outside Career": "加入职业模块之外的通用文书与元数据",
  "Create tags, collections, and workspace search": "建立标签、集合与工作台搜索",
  "Expose scoped knowledge retrieval to the AI Copilot": "向桦笺开放有边界的知识检索",
  "Move job search runs behind a shared automation contract": "让寻职运行遵循统一自动化约定",
  "Persist run status, counts, errors, and cost": "保存运行状态、数量、错误与成本",
  "Deploy execution to Cloud Run Jobs and Scheduler": "将执行部署至云端任务与调度器",
  "Add safe retry and manual run controls": "加入安全重试与手动运行控制",
  "Create a secure per-user connection model": "建立安全的逐用户联结模型",
  "Ship one-way Notion sync as the first integration": "以单向 Notion 同步作为首个联结",
  "Add email and calendar context with explicit permissions": "在明确权限下加入邮件与日历语境",
  "Expose a narrow authenticated API for browser capture": "为浏览器采集开放窄范围认证 API",
};

export default function WorkspaceModulePage({ eyebrow, title, subtitle, icon, statement, features, nextSteps, action }: Props) {
  const { language, text } = useLanguage();
  const localize = (value: string) => language === "zh" ? (ZH[value] ?? value) : value;
  return (
    <>
      <Header eyebrow={localize(eyebrow)} title={localize(title)} subtitle={localize(subtitle)} action={action ? <Link href={action.href} className="secondary-button">{localize(action.label)}<span aria-hidden="true">→</span></Link> : undefined} />
      <div className="mx-auto w-full max-w-[960px] space-y-8 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <section className="relative overflow-hidden rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] px-7 py-10 text-[#1E1A14] shadow-[0_2px_10px_rgba(30,26,20,0.07)] sm:px-10 lg:py-14">
          <div className="relative max-w-2xl">
            <span className="flex size-14 items-center justify-center rounded-[6px] border border-[rgba(30,26,20,0.12)] bg-[#EBE2CC]"><BirchIcon name={HERO_ICONS[icon] ?? "tree"} size={34} /></span>
            <p className="eyebrow mt-8 text-[#7A6A50]">{text("生长中的模块", "Living module")}</p>
            <h2 className="mt-3 text-3xl font-light leading-[1.55] tracking-[0.1em] sm:text-[38px]">{localize(statement)}</h2>
            <p className="latin mt-5 max-w-xl text-base font-light italic leading-7 text-[#7A6A50]">{text("工作台中克制的一部分，在不增加噪声的前提下获得深度。", "One measured part of the workspace, designed to gain depth without adding noise.")}</p>
          </div>
          <div className="absolute bottom-8 right-9 hidden lg:block" aria-hidden="true"><BirchIcon name="bark" size={72} className="opacity-10" /></div>
        </section>

        <section className="grid gap-5 md:grid-cols-3">
          {features.map((feature, index) => (
            <article key={feature.title} className="soft-card lift-card p-6">
              <div className="flex items-start justify-between gap-4">
                <span className="flex size-11 items-center justify-center rounded-[6px] bg-[#EBE2CC]"><BirchIcon name={ICONS[index] ?? "leaf"} size={27} /></span>
                <span className="rounded-[6px] border border-[rgba(30,26,20,0.12)] px-2 py-1 text-[9px] tracking-[0.15em] text-[#7A6A50]">{STATUS_LABELS[feature.status][language]}</span>
              </div>
              <h3 className="mt-7 text-base font-normal tracking-[0.12em] text-[#1E1A14]">{localize(feature.title)}</h3>
              <p className="mt-3 text-sm leading-7 text-[#7A6A50]">{localize(feature.description)}</p>
            </article>
          ))}
        </section>

        <section className="soft-card grid gap-8 p-6 sm:p-8 lg:grid-cols-[0.7fr_1.3fr]">
          <div><p className="eyebrow text-[#9A8468]">{text("培育路径", "Cultivation path")}</p><h3 className="mt-3 text-xl font-normal tracking-[0.12em]">{text("后续生长", "What grows next")}</h3><p className="mt-4 max-w-sm text-sm leading-7 text-[#7A6A50]">{text("按次序补足能力，让每一项功能都有清楚的位置与边界。", "Add capabilities in sequence so every function has a clear place and boundary.")}</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            {nextSteps.map((step, index) => (
              <div key={step} className="flex items-start gap-3 rounded-[6px] border border-[rgba(30,26,20,0.12)] bg-[#EBE2CC] p-4">
                <span className="latin text-lg italic text-[#9A8468]">{String(index + 1).padStart(2, "0")}</span>
                <p className="pt-0.5 text-xs leading-6 text-[#7A6A50]">{localize(step)}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
