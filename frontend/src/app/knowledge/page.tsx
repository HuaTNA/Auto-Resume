"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import { BirchIcon } from "@/components/icons/BirchIcons";
import { CreatePanel, EmptyState, Section, StatusPill, WorkspacePage } from "@/components/workspace/WorkspaceUI";
import { useLanguage } from "@/lib/language-context";
import { useWorkspace } from "@/lib/workspace-context";
import type { KnowledgeItem, KnowledgeKind } from "@/lib/workspace-types";

export default function KnowledgePage() {
  const { knowledge, createKnowledge, updateKnowledge, deleteKnowledge } = useWorkspace();
  const { text, language } = useLanguage();
  const [creating, setCreating] = useState(false); const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<KnowledgeItem | null>(null);
  const [capture, setCapture] = useState({ title: "", url: "", content: "" });
  useEffect(() => { const params = new URLSearchParams(window.location.search); if (params.has("new")) window.setTimeout(() => { setCapture({ title: params.get("title") ?? "", url: params.get("url") ?? "", content: params.get("content") ?? "" }); setCreating(true); }, 0); }, []);
  const visible = useMemo(() => knowledge.filter((item) => [item.title, item.content, item.url, ...item.tags].join(" ").toLowerCase().includes(query.toLowerCase())), [knowledge, query]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const title = String(form.get("title") ?? "").trim(); if (!title) return;
    const input = { title, kind: String(form.get("kind")) as KnowledgeKind, content: String(form.get("content") ?? ""), url: String(form.get("url") ?? ""), tags: String(form.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean) };
    if (editing) await updateKnowledge(editing.id, input);
    else await createKnowledge(input);
    event.currentTarget.reset(); setCreating(false); setEditing(null);
  }
  async function remove(item: KnowledgeItem) {
    if (!window.confirm(text(`确定删除「${item.title}」？`, `Delete “${item.title}”?`))) return;
    await deleteKnowledge(item.id);
  }
  const kinds = { note: { zh: "笔记", en: "Note" }, research: { zh: "研究", en: "Research" }, link: { zh: "链接", en: "Link" } };
  return <>
    <Header eyebrow={{ zh: "工作区记忆", en: "WORKSPACE MEMORY" }} title={{ zh: "知识", en: "Knowledge" }} subtitle={{ zh: "让笔记、研究与来源成为整个工作区可以复用的语境。", en: "Turn notes, research, and sources into reusable workspace context." }} action={<button onClick={() => setCreating(true)} className="primary-button"><span aria-hidden="true">＋</span>{text("新建", "New")}</button>} />
    <WorkspacePage>
      {(creating || editing) && <CreatePanel key={editing?.id ?? `create:${capture.url}`} title={editing ? text("编辑知识", "Edit knowledge") : text("添加知识", "Add knowledge")} onClose={() => { setCreating(false); setEditing(null); }}><form onSubmit={submit} className="grid gap-4 sm:grid-cols-3"><label className="text-xs sm:col-span-2">{text("标题", "Title")}<input name="title" required autoFocus defaultValue={editing?.title ?? capture.title} className="mt-1.5 min-h-11 w-full px-3" /></label><label className="text-xs">{text("类型", "Type")}<select name="kind" defaultValue={editing?.kind ?? (capture.url ? "link" : "note")} className="mt-1.5 min-h-11 w-full px-3"><option value="note">{text("笔记", "Note")}</option><option value="research">{text("研究", "Research")}</option><option value="link">{text("链接", "Link")}</option></select></label><label className="text-xs sm:col-span-3">{text("内容或摘要", "Content or summary")}<textarea name="content" rows={4} defaultValue={editing?.content ?? capture.content} className="mt-1.5 w-full px-3 py-2" /></label><label className="text-xs sm:col-span-2">URL<input name="url" type="url" defaultValue={editing?.url ?? capture.url} className="mt-1.5 min-h-11 w-full px-3" placeholder="https://" /></label><label className="text-xs">{text("标签（逗号分隔）", "Tags (comma separated)")}<input name="tags" defaultValue={editing?.tags.join(", ") ?? (capture.url ? "browser-capture" : "")} className="mt-1.5 min-h-11 w-full px-3" /></label><div className="sm:col-span-3"><button className="primary-button" type="submit">{text("保存", "Save")}</button></div></form></CreatePanel>}
      <div className="relative"><span className="absolute left-4 top-1/2 -translate-y-1/2"><BirchIcon name="growth-ring" size={17} /></span><input value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-12 w-full bg-[#FDFAF3] pl-11 pr-4" placeholder={text("搜索笔记、研究、链接或标签…", "Search notes, research, links, or tags…")} /></div>
      <Section title={text("知识库", "Library")} eyebrow={`${visible.length} ${text("项内容", "items")}`}>
        {visible.length === 0 ? <EmptyState icon="growth-ring" title={query ? text("没有匹配的内容", "No matching knowledge") : text("知识库还是空的", "Your library is empty")} description={query ? text("尝试更短的关键词或标签。", "Try a shorter keyword or tag.") : text("从一则笔记、一个研究结论或一条重要链接开始。", "Start with a note, a research finding, or an important link.")} action={query ? undefined : { label: text("添加第一条内容", "Add your first item"), onClick: () => setCreating(true) }} /> : <div className="grid gap-6 md:grid-cols-2">{visible.map((item) => <article key={item.id} className="lift-card rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-5"><div className="flex items-center justify-between"><StatusPill tone={item.kind === "research" ? "brand" : "neutral"}>{kinds[item.kind][language]}</StatusPill><div className="flex items-center gap-2"><button onClick={() => { setCreating(false); setEditing(item); }} className="text-[10px] underline decoration-[#B8A98A] underline-offset-4">{text("编辑", "Edit")}</button><button onClick={() => void remove(item)} className="text-[10px] text-[#7A6A50] underline decoration-[#B8A98A] underline-offset-4">{text("删除", "Delete")}</button>{item.url && <a href={item.url} target="_blank" rel="noreferrer" aria-label={text("打开来源", "Open source")} className="flex size-8 items-center justify-center rounded-[6px] hover:bg-[#FDFAF3]"><BirchIcon name="branch" size={16} /></a>}</div></div><h3 className="mt-5 text-base font-medium tracking-[0.1em]">{item.title}</h3><p className="mt-2 line-clamp-4 text-xs leading-6 text-[#7A6A50]">{item.content || text("暂无摘要", "No summary")}</p>{item.tags.length > 0 && <div className="mt-4 flex flex-wrap gap-1.5">{item.tags.map((tag) => <span key={tag} className="rounded-[6px] bg-[#EBE2CC] px-2 py-1 text-[9px] text-[#7A6A50]">#{tag}</span>)}</div>}</article>)}</div>}
      </Section>
    </WorkspacePage>
  </>;
}
