"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import { CreatePanel, EmptyState, Section, StatusPill, WorkspacePage } from "@/components/workspace/WorkspaceUI";
import { createInterviewNote, InterviewApplication, InterviewNote, listInterviews } from "@/lib/platform-api";
import { useLanguage } from "@/lib/language-context";

export default function InterviewPage() {
  const { text } = useLanguage();
  const [applications, setApplications] = useState<InterviewApplication[]>([]);
  const [notes, setNotes] = useState<InterviewNote[]>([]);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function load() { setLoading(true); try { const data = await listInterviews(); setApplications(data.applications); setNotes(data.notes); setError(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "Interview data could not be loaded"); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); try { await createInterviewNote({ application_record_id: Number(form.get("application")), kind: String(form.get("kind")), title: String(form.get("title")), content: String(form.get("content") ?? "") }); setCreating(false); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Note could not be saved"); } }
  return <><Header eyebrow={{ zh: "职业工作区", en: "CAREER WORKSPACE" }} title={{ zh: "面试准备", en: "Interview Prep" }} subtitle={{ zh: "把职位、经历故事、问题清单和复盘放进同一个语境。", en: "Keep role context, stories, questions, and debriefs together." }} action={applications.length ? <button onClick={() => setCreating(true)} className="primary-button">＋ {text("新建笔记", "New note")}</button> : undefined} /><WorkspacePage>
    {creating && <CreatePanel title={text("添加面试材料", "Add interview material")} onClose={() => setCreating(false)}><form onSubmit={submit} className="grid gap-4 sm:grid-cols-2"><label className="text-xs">{text("申请", "Application")}<select name="application" required className="mt-1.5 min-h-11 w-full px-3">{applications.map((item) => <option key={item.id} value={item.id}>{item.job_title} · {item.company}</option>)}</select></label><label className="text-xs">{text("类型", "Type")}<select name="kind" className="mt-1.5 min-h-11 w-full px-3"><option value="star">STAR Story</option><option value="question">{text("问题", "Question")}</option><option value="note">{text("笔记", "Note")}</option><option value="debrief">{text("复盘", "Debrief")}</option></select></label><label className="text-xs sm:col-span-2">{text("标题", "Title")}<input name="title" required className="mt-1.5 min-h-11 w-full px-3" /></label><label className="text-xs sm:col-span-2">{text("内容", "Content")}<textarea name="content" rows={6} className="mt-1.5 w-full px-3 py-2" /></label><button className="primary-button justify-self-start">{text("保存", "Save")}</button></form></CreatePanel>}
    {error && <p className="rounded-[12px] bg-[#EBE2CC] p-4 text-xs">{error}</p>}
    <Section title={text("面试中的申请", "Applications in interview")} eyebrow={`${applications.length}`}>
      {loading ? <div className="h-28 animate-pulse rounded-[16px] bg-[rgba(30,26,20,0.05)]" /> : applications.length === 0 ? <EmptyState icon="leaf" title={text("还没有进入面试阶段的申请", "No applications in interview yet")} description={text("在申请记录中将状态改为“面试中”，这里会自动建立面试工作区。", "Move an application to Interview and it will appear here automatically.")} action={{ label: text("查看申请", "Open applications"), href: "/career/applications" }} /> : <div className="grid gap-4 sm:grid-cols-2">{applications.map((item) => <article key={item.id} className="rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-5"><StatusPill tone="brand">Interview</StatusPill><h3 className="mt-4 text-sm font-medium">{item.job_title}</h3><p className="mt-1 text-xs text-[#7A6A50]">{item.company}</p></article>)}</div>}
    </Section>
    <Section title={text("准备材料", "Preparation library")} eyebrow={`${notes.length}`}><div className="grid gap-4 md:grid-cols-2">{notes.map((note) => <article key={note.id} className="rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-5"><StatusPill tone={note.kind === "star" ? "brand" : "neutral"}>{note.kind}</StatusPill><h3 className="mt-4 text-sm font-medium">{note.title}</h3><p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-[#7A6A50]">{note.content}</p></article>)}</div>{!notes.length && applications.length > 0 && <p className="text-xs text-[#7A6A50]">{text("还没有准备材料。", "No preparation material yet.")}</p>}</Section>
    <Link href="/knowledge?new=1" className="text-xs underline decoration-[#B8A98A] underline-offset-4">{text("也可以保存到知识库", "You can also save research to Knowledge")} →</Link>
  </WorkspacePage></>;
}
