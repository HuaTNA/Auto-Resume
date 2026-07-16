"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import { BirchIcon } from "@/components/icons/BirchIcons";
import { CreatePanel, EmptyState, Section, StatusPill, WorkspacePage } from "@/components/workspace/WorkspaceUI";
import { useLanguage } from "@/lib/language-context";
import { useWorkspace } from "@/lib/workspace-context";
import type { TaskPriority } from "@/lib/workspace-types";

type Filter = "today" | "upcoming" | "overdue" | "completed" | "all";

function localDate(offset = 0) { const date = new Date(); date.setDate(date.getDate() + offset); return date.toLocaleDateString("en-CA"); }

export default function TasksPage() {
  const { tasks, projects, createTask, updateTask } = useWorkspace();
  const { text, language } = useLanguage();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<Filter>("today");
  const today = localDate();

  useEffect(() => { const params = new URLSearchParams(window.location.search); window.setTimeout(() => { if (params.has("new")) setCreating(true); if (params.get("view") === "all") setFilter("all"); }, 0); }, []);
  const visible = useMemo(() => tasks.filter((task) => {
    if (filter === "completed") return task.status === "done";
    if (task.status === "done") return false;
    if (filter === "today") return !task.due_date || task.due_date === today;
    if (filter === "upcoming") return Boolean(task.due_date && task.due_date > today);
    if (filter === "overdue") return Boolean(task.due_date && task.due_date < today);
    return true;
  }), [filter, tasks, today]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const title = String(form.get("title") ?? "").trim(); if (!title) return;
    createTask({ title, priority: String(form.get("priority")) as TaskPriority, due_date: String(form.get("due_date") ?? ""), project_id: String(form.get("project_id") ?? "") });
    event.currentTarget.reset(); setCreating(false);
  }

  const filters: Array<{ id: Filter; zh: string; en: string }> = [{ id: "today", zh: "今天", en: "Today" }, { id: "upcoming", zh: "即将到来", en: "Upcoming" }, { id: "overdue", zh: "已逾期", en: "Overdue" }, { id: "completed", zh: "已完成", en: "Completed" }, { id: "all", zh: "全部", en: "All" }];
  return <>
    <Header eyebrow={{ zh: "统一行动层", en: "UNIFIED ACTION LAYER" }} title={{ zh: "任务", en: "Tasks" }} subtitle={{ zh: "管理来自项目、职业、知识与 AI 建议的下一步行动。", en: "Manage next actions from projects, career, knowledge, and AI suggestions." }} action={<button onClick={() => setCreating(true)} className="primary-button"><span aria-hidden="true">＋</span>{text("新建任务", "New task")}</button>} />
    <WorkspacePage>
      {creating && <CreatePanel title={text("添加任务", "Add a task")} onClose={() => setCreating(false)}><form onSubmit={submit} className="grid gap-4 sm:grid-cols-4"><label className="text-xs sm:col-span-2">{text("任务", "Task")}<input name="title" required autoFocus className="mt-1.5 min-h-11 w-full px-3" /></label><label className="text-xs">{text("截止日期", "Due date")}<input name="due_date" type="date" defaultValue={today} className="mt-1.5 min-h-11 w-full px-3" /></label><label className="text-xs">{text("优先级", "Priority")}<select name="priority" defaultValue="medium" className="mt-1.5 min-h-11 w-full px-3"><option value="high">{text("高", "High")}</option><option value="medium">{text("中", "Medium")}</option><option value="low">{text("低", "Low")}</option></select></label><label className="text-xs sm:col-span-2">{text("关联项目", "Related project")}<select name="project_id" className="mt-1.5 min-h-11 w-full px-3"><option value="">{text("无", "None")}</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label><div className="flex items-end sm:col-span-2"><button className="primary-button" type="submit">{text("添加任务", "Add task")}</button></div></form></CreatePanel>}
      <div className="flex gap-2 overflow-x-auto pb-1">{filters.map((item) => <button key={item.id} onClick={() => setFilter(item.id)} className={`min-h-9 shrink-0 rounded-[6px] px-4 text-[11px] ${filter === item.id ? "bg-[#1E1A14] text-[#F5EFE0]" : "border border-[rgba(30,26,20,0.12)] bg-transparent text-[#7A6A50] hover:bg-[#FDFAF3]"}`}>{language === "zh" ? item.zh : item.en}</button>)}</div>
      <Section title={filters.find((item) => item.id === filter)?.[language === "zh" ? "zh" : "en"] ?? "Tasks"} eyebrow={`${visible.length} ${text("项", "items")}`}>
        {visible.length === 0 ? <EmptyState icon="catkin" title={text("这里暂时没有任务", "Nothing here right now")} description={filter === "today" ? text("今天的工作区是清爽的。你可以添加一个明确的下一步。", "Today is clear. Add one concrete next action when you are ready.") : text("切换筛选，或创建一项新任务。", "Change the filter or create a new task.")} action={{ label: text("添加任务", "Add task"), onClick: () => setCreating(true) }} /> : <div className="overflow-hidden rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0]">{visible.map((task, index) => <article key={task.id} className={`flex items-start gap-4 p-4 sm:px-5 ${index ? "border-t border-[rgba(30,26,20,0.12)]" : ""}`}><button onClick={() => updateTask(task.id, { status: task.status === "done" ? "todo" : "done" })} aria-label={text("完成任务", "Complete task")} className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-[6px] border border-[rgba(30,26,20,0.12)] ${task.status === "done" ? "bg-[#1E1A14]" : "bg-[#FDFAF3]"}`}>{task.status === "done" && <BirchIcon name="bud" size={14} />}</button><div className="min-w-0 flex-1"><p className={`text-sm ${task.status === "done" ? "text-[#9A8468] line-through" : ""}`}>{task.title}</p><div className="mt-2 flex flex-wrap items-center gap-2">{task.due_date && <span className="text-[10px] text-[#7A6A50]">{task.due_date}</span>}{task.project_id && <span className="text-[10px] text-[#7A6A50]">· {projects.find((project) => project.id === task.project_id)?.title}</span>}</div></div><StatusPill tone={task.priority === "high" ? "warning" : task.priority === "medium" ? "brand" : "neutral"}>{task.priority}</StatusPill></article>)}</div>}
      </Section>
    </WorkspacePage>
  </>;
}
