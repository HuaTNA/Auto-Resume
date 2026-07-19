"use client";

import { FormEvent, useEffect, useState } from "react";
import Header from "@/components/Header";
import { CreatePanel, EmptyState, Section, StatusPill, WorkspacePage } from "@/components/workspace/WorkspaceUI";
import { useLanguage } from "@/lib/language-context";
import { useWorkspace } from "@/lib/workspace-context";
import type { ProjectStatus, WorkspaceProject } from "@/lib/workspace-types";

const STATUS: Record<ProjectStatus, { zh: string; en: string; tone: "neutral" | "brand" | "success" | "warning" }> = {
  planned: { zh: "规划中", en: "Planned", tone: "neutral" }, active: { zh: "进行中", en: "Active", tone: "brand" }, blocked: { zh: "受阻", en: "Blocked", tone: "warning" }, completed: { zh: "已完成", en: "Completed", tone: "success" },
};

export default function ProjectsPage() {
  const { projects, createProject, updateProject, deleteProject } = useWorkspace();
  const { text, language } = useLanguage();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<WorkspaceProject | null>(null);

  useEffect(() => { if (new URLSearchParams(window.location.search).has("new")) window.setTimeout(() => setCreating(true), 0); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    if (!title) return;
    const input = { title, summary: String(form.get("summary") ?? ""), next_action: String(form.get("next_action") ?? ""), due_date: String(form.get("due_date") ?? "") };
    if (editing) await updateProject(editing.id, input);
    else await createProject(input);
    event.currentTarget.reset(); setCreating(false); setEditing(null);
  }

  async function remove(project: WorkspaceProject) {
    if (!window.confirm(text(`确定删除项目「${project.title}」？关联任务不会被删除。`, `Delete “${project.title}”? Related tasks will be kept.`))) return;
    await deleteProject(project.id);
  }

  return <>
    <Header eyebrow={{ zh: "个人工作区", en: "PERSONAL WORKSPACE" }} title={{ zh: "项目", en: "Projects" }} subtitle={{ zh: "把目标、资料、任务和下一步放在同一个项目语境里。", en: "Keep goals, context, tasks, and next actions together." }} action={<button onClick={() => setCreating(true)} className="primary-button"><span aria-hidden="true">＋</span>{text("新建项目", "New project")}</button>} />
    <WorkspacePage>
      {(creating || editing) && <CreatePanel key={editing?.id ?? "create"} title={editing ? text("编辑项目", "Edit project") : text("创建项目", "Create a project")} description={text("定义目的和一个清晰的下一步。", "Define the purpose and one clear next action.")} onClose={() => { setCreating(false); setEditing(null); }}><form onSubmit={submit} className="grid gap-4 sm:grid-cols-2"><label className="text-xs">{text("项目名称", "Project name")}<input name="title" required autoFocus defaultValue={editing?.title} className="mt-1.5 min-h-11 w-full px-3" placeholder={text("例如：Personal AI Workspace", "e.g. Personal AI Workspace")} /></label><label className="text-xs">{text("目标日期", "Target date")}<input name="due_date" type="date" defaultValue={editing?.due_date} className="mt-1.5 min-h-11 w-full px-3" /></label><label className="text-xs sm:col-span-2">{text("项目说明", "Project summary")}<textarea name="summary" rows={2} defaultValue={editing?.summary} className="mt-1.5 w-full px-3 py-2" /></label><label className="text-xs sm:col-span-2">{text("下一步行动", "Next action")}<input name="next_action" defaultValue={editing?.next_action} className="mt-1.5 min-h-11 w-full px-3" placeholder={text("写下一个可以立即执行的动作", "Write one action you can take next")} /></label><div className="sm:col-span-2"><button className="primary-button" type="submit">{editing ? text("保存更改", "Save changes") : text("创建项目", "Create project")}</button></div></form></CreatePanel>}

      <Section title={text("所有项目", "All projects")} eyebrow={`${projects.filter((project) => project.status === "active").length} ${text("个正在进行", "active")}`}>
        {projects.length === 0 ? <EmptyState icon="branch" title={text("还没有项目", "No projects yet")} description={text("项目是工作站的长期语境：它可以连接任务、知识、文档、链接与自动化。", "Projects are durable workspace context, connecting tasks, knowledge, documents, links, and automations.")} action={{ label: text("创建第一个项目", "Create your first project"), onClick: () => setCreating(true) }} /> : <div className="grid gap-6 md:grid-cols-2">{projects.map((project) => <article key={project.id} className="lift-card rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-5 shadow-[0_2px_10px_rgba(30,26,20,0.07)]">
          <div className="flex items-start justify-between gap-4"><StatusPill tone={STATUS[project.status].tone}>{STATUS[project.status][language]}</StatusPill><div className="flex items-center gap-2"><select value={project.status} onChange={(event) => updateProject(project.id, { status: event.target.value as ProjectStatus, progress: event.target.value === "completed" ? 100 : project.progress })} aria-label={text("项目状态", "Project status")} className="min-h-8 px-2 text-[10px]">{Object.entries(STATUS).map(([value, option]) => <option key={value} value={value}>{option[language]}</option>)}</select><button onClick={() => { setCreating(false); setEditing(project); }} className="min-h-8 rounded-[6px] border border-[rgba(30,26,20,0.12)] px-2.5 text-[10px] hover:bg-[#FDFAF3]">{text("编辑", "Edit")}</button><button onClick={() => void remove(project)} className="min-h-8 px-1.5 text-[10px] text-[#7A6A50] underline decoration-[#B8A98A] underline-offset-4">{text("删除", "Delete")}</button></div></div>
          <h3 className="mt-5 text-lg font-medium tracking-[0.1em]">{project.title}</h3><p className="mt-2 min-h-12 text-xs leading-6 text-[#7A6A50]">{project.summary || text("尚未添加项目说明。", "No summary yet.")}</p>
          <div className="mt-5"><div className="latin mb-2 flex justify-between text-[9px] uppercase tracking-[0.24em] text-[#9A8468]"><span>{text("进度", "Progress")}</span><span>{project.progress}%</span></div><input type="range" min="0" max="100" step="10" value={project.progress} onChange={(event) => updateProject(project.id, { progress: Number(event.target.value) })} className="h-1.5 w-full cursor-pointer accent-[#1E1A14]" /></div>
          <div className="mt-5 rounded-[6px] bg-[#EBE2CC] p-3"><p className="latin text-[9px] uppercase tracking-[0.24em] text-[#9A8468]">{text("下一步", "Next action")}</p><p className="mt-1 text-xs">{project.next_action || text("还没有定义下一步", "Next action not defined")}</p></div>
          {project.due_date && <p className="mt-4 text-[10px] text-[#7A6A50]">{text("目标日期", "Target")} · {project.due_date}</p>}
        </article>)}</div>}
      </Section>
    </WorkspacePage>
  </>;
}
