"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import { EmptyState, Section, StatusPill, WorkspacePage } from "@/components/workspace/WorkspaceUI";
import { BirchIcon } from "@/components/icons/BirchIcons";
import { getHealth, getHistory } from "@/lib/api";
import { useLanguage } from "@/lib/language-context";
import { useWorkspace } from "@/lib/workspace-context";
import { listNotifications, markNotificationRead, WorkspaceNotification } from "@/lib/platform-api";

interface CareerRecord { id: number; job_title: string; company: string; status: string; timestamp: string; match_score: number; has_resume: boolean; ats_scores: { overall: number | null } }
function dateKey(offset = 0) { const date = new Date(); date.setDate(date.getDate() + offset); return date.toLocaleDateString("en-CA"); }

export default function CommandCenter() {
  const { tasks, projects, knowledge, activities, updateTask, isLoading } = useWorkspace();
  const { text, language } = useLanguage();
  const [career, setCareer] = useState<CareerRecord[]>([]);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [notifications, setNotifications] = useState<WorkspaceNotification[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const today = dateKey();

  useEffect(() => {
    getHistory().then((result) => setCareer(result.records ?? [])).catch(() => setCareer([]));
    getHealth().then(() => setBackendOnline(true)).catch(() => setBackendOnline(false));
    listNotifications(true).then((result) => setNotifications(result.notifications)).catch(() => setNotifications([]));
  }, []);

  const todayTasks = tasks.filter((task) => task.status === "todo" && (!task.due_date || task.due_date === today)).slice(0, 5);
  const upcoming = tasks.filter((task) => task.status === "todo" && task.due_date && task.due_date > today).sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")).slice(0, 4);
  const activeProjects = projects.filter((project) => project.status === "active" || project.status === "blocked").slice(0, 3);
  const activeApplications = career.filter((record) => ["suggested", "generated", "applied", "interview"].includes(record.status)).slice(0, 3);
  const suggestions = useMemo(() => {
    const items: Array<{ title: string; detail: string; href: string }> = [];
    const overdue = tasks.filter((task) => task.status === "todo" && task.due_date && task.due_date < today).length;
    if (overdue) items.push({ title: text(`先处理 ${overdue} 项逾期任务`, `Review ${overdue} overdue task${overdue > 1 ? "s" : ""}`), detail: text("清理过期承诺，再决定今天新增什么。", "Clear old commitments before adding new work."), href: "/tasks?view=all" });
    const needsNext = projects.find((project) => project.status === "active" && !project.next_action);
    if (needsNext) items.push({ title: text(`为「${needsNext.title}」定义下一步`, `Define the next action for “${needsNext.title}”`), detail: text("活跃项目最好始终有一个可执行动作。", "Every active project should have one concrete next action."), href: "/projects" });
    const interviews = career.filter((record) => record.status === "interview").length;
    if (interviews) items.push({ title: text(`准备 ${interviews} 项面试`, `Prepare for ${interviews} interview${interviews > 1 ? "s" : ""}`), detail: text("把职位语境、故事和问题整理到一起。", "Bring role context, stories, and questions together."), href: "/career/interview" });
    if (!items.length) items.push({ title: text("工作区状态清晰", "Your workspace is clear"), detail: text("选择一个最重要的结果，并把它拆成今天的一步。", "Choose one meaningful outcome and turn it into one step for today."), href: "/tasks?new=1" });
    return items.slice(0, 3);
  }, [career, projects, tasks, text, today]);

  return <>
    <Header eyebrow={{ zh: "个人 AI 工作站", en: "PERSONAL AI WORKSPACE" }} title={{ zh: "指挥中心", en: "Command Center" }} subtitle={{ zh: "今天要处理的事，以及整个工作区正在发生的变化。", en: "What needs your attention today, across the whole workspace." }} action={<button onClick={() => window.dispatchEvent(new Event("hua-command-palette"))} className="secondary-button hidden sm:inline-flex"><BirchIcon name="growth-ring" size={16} />⌘K</button>} />
    <WorkspacePage>
      <section className="relative z-10 overflow-visible rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-5 shadow-[0_2px_8px_rgba(30,26,20,0.05)] sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-xl">
            <p className="eyebrow text-[#9A8468]">{text("今日概览", "Today at a glance")}</p>
            <h2 className="mt-2 text-xl font-normal tracking-[0.08em] text-[#1E1A14] sm:text-2xl">{suggestions[0]?.title}</h2>
            <p className="mt-2 text-xs leading-6 text-[#7A6A50]">{suggestions[0]?.detail}</p>
          </div>
          <div className="flex flex-wrap gap-2.5"><Link href="/copilot" className="primary-button"><BirchIcon name="leaf" size={15} className="brightness-[4]" />{text("询问 AI", "Ask AI")}</Link><div className="relative"><button onClick={() => setCreateOpen((open) => !open)} aria-expanded={createOpen} aria-haspopup="menu" className="secondary-button"><span aria-hidden="true">＋</span>{text("新建", "Create")}<span aria-hidden="true">⌄</span></button>{createOpen && <div role="menu" className="absolute right-0 top-[calc(100%+8px)] z-30 w-52 rounded-[12px] border border-[rgba(30,26,20,0.10)] bg-[#F5EFE0] p-2 shadow-[0_16px_48px_rgba(30,26,20,0.16),0_4px_16px_rgba(30,26,20,0.08)]">{[{ href: "/projects?new=1", zh: "项目", en: "Project" }, { href: "/tasks?new=1", zh: "任务", en: "Task" }, { href: "/knowledge?new=1", zh: "知识内容", en: "Knowledge item" }, { href: "/generate", zh: "职业文档", en: "Career document" }].map((item) => <Link key={item.href} href={item.href} role="menuitem" onClick={() => setCreateOpen(false)} className="block rounded-[6px] px-3 py-2 text-xs hover:bg-[#FDFAF3]">{item[language]}</Link>)}</div>}</div></div>
        </div>
        <div className="mt-5 grid grid-cols-3 border-t border-[rgba(30,26,20,0.10)] pt-4">
          {[{ value: todayTasks.length, zh: "今日任务", en: "Today" }, { value: activeProjects.length, zh: "活跃项目", en: "Projects" }, { value: notifications.length, zh: "未读通知", en: "Unread" }].map((item, index) => <div key={item.en} className={`px-4 first:pl-0 ${index ? "border-l border-[rgba(30,26,20,0.10)]" : ""}`}><p className="latin text-xl text-[#1E1A14]">{item.value}</p><p className="mt-0.5 text-[10px] text-[#7A6A50]">{language === "zh" ? item.zh : item.en}</p></div>)}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-5">
          <Section title={text("今天", "Today")} eyebrow={new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-CA", { weekday: "long", month: "long", day: "numeric" }).format(new Date())} action={<Link href="/tasks" className="text-xs text-[#1E1A14] underline decoration-[#B8A98A] underline-offset-4">{text("查看全部", "View all")} →</Link>}>
            {isLoading ? <div className="h-32 animate-pulse rounded-[16px] bg-[rgba(30,26,20,0.05)]" /> : todayTasks.length === 0 ? <EmptyState icon="catkin" title={text("今天还没有安排", "Nothing scheduled for today")} description={text("保留空白，或添加一个最重要的下一步。", "Keep the space open, or add the one next action that matters.")} action={{ label: text("添加任务", "Add a task"), href: "/tasks?new=1" }} /> : <div className="overflow-hidden rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0]">{todayTasks.map((task, index) => <div key={task.id} className={`flex items-center gap-4 p-4 ${index ? "border-t border-[rgba(30,26,20,0.12)]" : ""}`}><button onClick={() => updateTask(task.id, { status: "done" })} aria-label={text("完成", "Complete")} className="flex size-6 items-center justify-center rounded-[6px] border border-[rgba(30,26,20,0.12)] bg-[#FDFAF3]"><BirchIcon name="bud" size={14} /></button><span className="min-w-0 flex-1 truncate text-sm">{task.title}</span><StatusPill tone={task.priority === "high" ? "warning" : "neutral"}>{task.priority}</StatusPill></div>)}</div>}
          </Section>

          <Section title={text("继续工作", "Continue Working")} eyebrow={text("项目与职业", "Projects and career")}>
            {activeProjects.length === 0 && activeApplications.length === 0 ? <EmptyState icon="branch" title={text("没有正在进行的工作", "No active work yet")} description={text("创建一个项目，或从 Career 中保存一个职位。", "Create a project or save an opportunity in Career.")} action={{ label: text("创建项目", "Create project"), href: "/projects?new=1" }} /> : <div className="grid gap-3 sm:grid-cols-2">{activeProjects.map((project) => <Link key={project.id} href="/projects" className="lift-card rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-4"><div className="flex items-center justify-between"><StatusPill tone={project.status === "blocked" ? "warning" : "brand"}>{project.status}</StatusPill><span className="text-[10px] text-[#7A6A50]">{project.progress}%</span></div><h3 className="mt-3 text-sm font-medium tracking-[0.1em]">{project.title}</h3><p className="mt-2 truncate text-[11px] text-[#7A6A50]">{project.next_action || text("需要定义下一步", "Needs a next action")}</p></Link>)}{activeApplications.map((record) => <Link key={record.id} href="/career/applications" className="lift-card rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-4"><div className="flex items-center justify-between"><StatusPill tone="success">{record.status}</StatusPill><span className="text-[10px] text-[#7A6A50]">{record.match_score > 0 ? `${text("匹配", "Match")} ${record.match_score}%` : record.has_resume && record.ats_scores.overall != null ? `ATS ${record.ats_scores.overall}%` : "—"}</span></div><h3 className="mt-3 truncate text-sm font-medium tracking-[0.1em]">{record.job_title}</h3><p className="mt-2 truncate text-[11px] text-[#7A6A50]">{record.company}{record.match_score > 0 && record.has_resume && record.ats_scores.overall != null ? ` · ATS ${record.ats_scores.overall}%` : ""}</p></Link>)}</div>}
          </Section>
        </div>

        <div className="space-y-5">
          <Section title={text("AI 建议", "AI Suggestions")} eyebrow={text("基于当前工作区", "From workspace context")}>
            <div className="rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#EBE2CC] p-3">{suggestions.map((item, index) => <Link key={item.title} href={item.href} className={`group flex gap-3 rounded-[6px] p-3 transition-all duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] hover:-translate-y-1 hover:bg-[#FDFAF3] ${index ? "border-t border-[rgba(30,26,20,0.12)]" : ""}`}><span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[6px] bg-[#F5EFE0]"><BirchIcon name="leaf" size={16} /></span><span className="min-w-0 flex-1"><span className="block text-xs font-medium">{item.title}</span><span className="mt-1 block text-[10px] leading-5 text-[#7A6A50]">{item.detail}</span></span><span className="mt-1 text-[#9A8468]" aria-hidden="true">→</span></Link>)}</div>
          </Section>

          <Section title={text("即将到来", "Upcoming")} eyebrow={text("日期与提醒", "Dates and reminders")} action={<Link href="/tasks?view=all" className="text-xs text-[#1E1A14] underline decoration-[#B8A98A] underline-offset-4">{text("任务", "Tasks")} →</Link>}>
            {upcoming.length === 0 ? <div className="rounded-[16px] border border-[rgba(30,26,20,0.12)] px-4 py-5 text-center text-[11px] text-[#7A6A50]">{text("近期没有已安排的截止日期", "No upcoming due dates")}</div> : <div className="space-y-2">{upcoming.map((task) => <div key={task.id} className="flex items-center gap-3 rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-3"><span className="flex size-9 items-center justify-center rounded-[6px] bg-[#EBE2CC] text-[10px]">{task.due_date?.slice(5)}</span><span className="min-w-0 flex-1 truncate text-xs">{task.title}</span></div>)}</div>}
          </Section>

          <Section title={text("最近活动", "Recent Activity")} eyebrow={text("跨模块变化", "Across the workspace")}>
            {activities.length === 0 ? <p className="rounded-[16px] border border-[rgba(30,26,20,0.12)] px-4 py-5 text-center text-[11px] text-[#7A6A50]">{text("创建项目、任务或知识后，活动会出现在这里。", "Changes to projects, tasks, and knowledge will appear here.")}</p> : <div className="space-y-3">{activities.slice(0, 5).map((item) => <div key={item.id} className="flex items-start gap-3"><span className="mt-1.5 size-1.5 bg-[#B8A98A]" /><div className="min-w-0"><p className="truncate text-xs">{item.title}</p><p className="latin mt-0.5 text-[9px] uppercase tracking-[0.22em] text-[#9A8468]">{item.module} · {item.action}</p></div></div>)}</div>}
          </Section>

          {notifications.length > 0 && <Section title={text("通知", "Notifications")} eyebrow={`${notifications.length} ${text("条未读", "unread")}`}><div className="space-y-2">{notifications.slice(0, 5).map((item) => <Link key={item.id} href={item.href || "/automations"} onClick={() => { void markNotificationRead(item.id); setNotifications((current) => current.filter((entry) => entry.id !== item.id)); }} className="block rounded-[12px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-4"><p className="text-xs font-medium">{item.title}</p><p className="mt-1 text-[10px] leading-5 text-[#7A6A50]">{item.message}</p></Link>)}</div></Section>}

          <div className="flex items-center gap-3 rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-4"><span className={`size-2.5 ${backendOnline === null ? "bg-[#9A8468]" : backendOnline ? "bg-[#B8A98A]" : "bg-[#1E1A14]"}`} /><div className="flex-1"><p className="text-xs font-medium">{text("工作区服务", "Workspace services")}</p><p className="mt-0.5 text-[10px] text-[#7A6A50]">{backendOnline === null ? text("正在检查…", "Checking…") : backendOnline ? text("在线，自动化可连接", "Online, ready for automations") : text("离线，部分职业功能不可用", "Offline, some Career features are unavailable")}</p></div><Link href="/automations" className="text-[10px] text-[#1E1A14] underline decoration-[#B8A98A] underline-offset-4">{text("查看", "View")}</Link></div>
        </div>
      </div>
      <p className="text-center text-[10px] text-[#9A8468]">{text(`${projects.length} 个项目 · ${tasks.filter((task) => task.status === "todo").length} 项待办 · ${knowledge.length} 条知识`, `${projects.length} projects · ${tasks.filter((task) => task.status === "todo").length} open tasks · ${knowledge.length} knowledge items`)}</p>
    </WorkspacePage>
  </>;
}
