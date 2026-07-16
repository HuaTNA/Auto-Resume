"use client";

import Link from "next/link";
import Header from "@/components/Header";
import { BirchIcon } from "@/components/icons/BirchIcons";
import { Section, StatusPill, WorkspacePage } from "@/components/workspace/WorkspaceUI";
import { useLanguage } from "@/lib/language-context";
import { useWorkspace } from "@/lib/workspace-context";

export default function CopilotPage() {
  const { projects, tasks, knowledge } = useWorkspace(); const { text } = useLanguage();
  const openTasks = tasks.filter((task) => task.status === "todo").length;
  return <><Header eyebrow={{ zh: "全局智能层", en: "WORKSPACE INTELLIGENCE" }} title={{ zh: "AI 助手", en: "AI Copilot" }} subtitle={{ zh: "理解整个工作区，而不只是一条提示词。", en: "An assistant designed to understand the whole workspace, not just one prompt." }} action={<button onClick={() => window.dispatchEvent(new Event("hua-command-palette"))} className="secondary-button"><BirchIcon name="growth-ring" size={16} />⌘K</button>} /><WorkspacePage>
    <section className="rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-6 shadow-[0_2px_10px_rgba(30,26,20,0.07)] sm:p-9"><span className="flex size-12 items-center justify-center rounded-[6px] bg-[#EBE2CC]"><BirchIcon name="leaf" size={27} /></span><p className="latin mt-6 text-[9px] uppercase tracking-[0.32em] text-[#9A8468]">Context · Creation · Safe action</p><h2 className="mt-3 max-w-2xl text-2xl font-medium leading-[1.45] tracking-[0.1em] sm:text-3xl">{text("一个贯穿项目、职业、知识、文档与自动化的协作入口。", "One collaborative entry point across projects, career, knowledge, documents, and automations.")}</h2><div className="mt-6 flex flex-wrap gap-2"><StatusPill tone="brand">{projects.length} {text("个项目", "projects")}</StatusPill><StatusPill tone="warning">{openTasks} {text("项待办", "open tasks")}</StatusPill><StatusPill tone="neutral">{knowledge.length} {text("条知识", "knowledge items")}</StatusPill></div></section>
    <Section title={text("现在可以使用的 AI 工作流", "AI workflows available now")} eyebrow={text("从现有能力进入", "Powered by existing capabilities")}><div className="grid gap-6 md:grid-cols-3">{[
      { href: "/generate", icon: "branch" as const, title: text("生成与优化职业文档", "Generate and refine career documents"), detail: text("调用现有 Claude 流程生成简历、求职信并进行 ATS 优化。", "Use the existing Claude pipeline for resumes, cover letters, and ATS refinement.") },
      { href: "/search", icon: "bud" as const, title: text("分析职位机会", "Analyze job opportunities"), detail: text("清洗职位描述、解析要求并评估个人匹配。", "Clean job descriptions, parse requirements, and assess fit.") },
      { href: "/tasks", icon: "catkin" as const, title: text("整理下一步行动", "Organize next actions"), detail: text("查看由当前工作区状态形成的优先级建议。", "Review priority suggestions derived from current workspace state.") },
    ].map((item) => <Link key={item.href} href={item.href} className="lift-card group rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-5"><BirchIcon name={item.icon} size={22} /><h3 className="mt-4 text-sm font-medium tracking-[0.1em]">{item.title}</h3><p className="mt-2 text-xs leading-6 text-[#7A6A50]">{item.detail}</p><span className="mt-4 block text-[#9A8468]" aria-hidden="true">→</span></Link>)}</div></Section>
    <div className="rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-5"><div className="flex items-center gap-2"><span className="size-2 bg-[#B8A98A]" /><p className="text-xs font-medium tracking-[0.1em]">{text("全局对话接口：基础结构已预留", "Global conversation API: foundation reserved")}</p></div><p className="mt-2 text-xs leading-6 text-[#7A6A50]">{text("当前不会伪装成已经完成的聊天机器人。下一阶段会把统一 AI Context、权限确认、工具调用和用量记录接入这个入口。", "This screen does not pretend a workspace-wide chat runtime already exists. The next phase connects shared AI context, confirmations, tool actions, and usage tracking here.")}</p></div>
  </WorkspacePage></>;
}
