"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import { BirchIcon } from "@/components/icons/BirchIcons";
import { CreatePanel, EmptyState, Section, StatusPill, WorkspacePage } from "@/components/workspace/WorkspaceUI";
import { createDocument, createDocumentVersion, deleteDocument, getDocument, listDocuments, PlatformDocument, PlatformDocumentVersion, updateDocument } from "@/lib/platform-api";
import { useLanguage } from "@/lib/language-context";

export default function DocumentsPage() {
  const { text } = useLanguage();
  const [documents, setDocuments] = useState<PlatformDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<PlatformDocument | null>(null);
  const [versions, setVersions] = useState<PlatformDocumentVersion[]>([]);
  const [activeVersion, setActiveVersion] = useState(0);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true); setError("");
    try { setDocuments((await listDocuments()).documents); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Documents could not be loaded"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await createDocument({ title: String(form.get("title")), kind: String(form.get("kind")), content: String(form.get("content") ?? "") });
      setCreating(false); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Document could not be created"); }
  }

  async function open(document: PlatformDocument) {
    setError("");
    try {
      const detail = await getDocument(document.id);
      setSelected(detail.document); setVersions(detail.versions);
      setActiveVersion(detail.versions[0]?.version_number ?? 0); setContent(detail.versions[0]?.content ?? "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Document could not be opened"); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return;
    const form = new FormData(event.currentTarget); setSaving(true); setError("");
    try {
      await updateDocument(selected.id, { title: String(form.get("title") ?? "").trim(), kind: String(form.get("kind") ?? selected.kind) });
      await createDocumentVersion(selected.id, content);
      await load(); await open({ ...selected, title: String(form.get("title") ?? selected.title), kind: String(form.get("kind") ?? selected.kind) });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Document could not be saved"); }
    finally { setSaving(false); }
  }

  async function remove() {
    if (!selected || !window.confirm(text(`确定删除文档「${selected.title}」及其全部版本？`, `Delete “${selected.title}” and all its versions?`))) return;
    try { await deleteDocument(selected.id); setSelected(null); setVersions([]); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Document could not be deleted"); }
  }

  return <><Header eyebrow={{ zh: "统一内容库", en: "UNIFIED CONTENT LIBRARY" }} title={{ zh: "文档", en: "Documents" }} subtitle={{ zh: "集中查看生成内容、独立文档与版本历史。", en: "Find generated content, standalone documents, and version history." }} action={<button onClick={() => setCreating(true)} className="primary-button">＋ {text("新建文档", "New document")}</button>} /><WorkspacePage>
    {creating && <CreatePanel title={text("新建文档", "Create a document")} onClose={() => setCreating(false)}><form onSubmit={submit} className="grid gap-4"><label className="text-xs">{text("标题", "Title")}<input name="title" required autoFocus className="mt-1.5 min-h-11 w-full px-3" /></label><label className="text-xs">{text("类型", "Type")}<select name="kind" className="mt-1.5 min-h-11 w-full px-3"><option value="note">{text("普通文档", "Document")}</option><option value="draft">{text("草稿", "Draft")}</option></select></label><label className="text-xs">{text("内容", "Content")}<textarea name="content" rows={7} className="mt-1.5 w-full px-3 py-2" /></label><button className="primary-button justify-self-start">{text("保存", "Save")}</button></form></CreatePanel>}
    {selected && <CreatePanel title={text("文档编辑器", "Document editor")} description={text(`当前共 ${versions.length} 个版本`, `${versions.length} versions available`)} onClose={() => setSelected(null)}><form onSubmit={save} className="grid gap-5 lg:grid-cols-[1fr_150px]"><div className="space-y-4"><div className="grid gap-4 sm:grid-cols-[1fr_160px]"><label className="text-xs">{text("标题", "Title")}<input name="title" required defaultValue={selected.title} className="mt-1.5 min-h-11 w-full px-3" /></label><label className="text-xs">{text("类型", "Type")}<input name="kind" required defaultValue={selected.kind} className="mt-1.5 min-h-11 w-full px-3" /></label></div><label className="block text-xs">{text("内容", "Content")}<textarea value={content} onChange={(event) => setContent(event.target.value)} rows={16} className="mt-1.5 w-full px-3 py-2 font-mono text-[11px] leading-5" /></label><div className="flex flex-wrap gap-3"><button disabled={saving} className="primary-button disabled:opacity-50">{saving ? text("保存中…", "Saving…") : text("保存为新版本", "Save new version")}</button><button type="button" onClick={() => void remove()} className="secondary-button text-[#7A6A50]">{text("删除文档", "Delete document")}</button></div></div><aside className="border-l border-[rgba(30,26,20,0.10)] pl-4"><p className="eyebrow mb-3 text-[#9A8468]">{text("版本历史", "Version history")}</p><div className="space-y-2">{versions.map((version) => <button type="button" key={version.id} onClick={() => { setActiveVersion(version.version_number); setContent(version.content); }} className={`w-full rounded-[6px] px-3 py-2 text-left text-[10px] ${activeVersion === version.version_number ? "bg-[#1E1A14] text-[#F5EFE0]" : "bg-[#EBE2CC] text-[#1E1A14]"}`}><span className="block">v{version.version_number}</span><span className="mt-0.5 block opacity-70">{new Date(version.created_at).toLocaleDateString()}</span></button>)}</div></aside></form></CreatePanel>}
    <div className="grid gap-6 sm:grid-cols-2"><Link href="/templates" className="lift-card flex items-center gap-4 rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-5"><BirchIcon name="bark" size={23} /><span className="flex-1 text-sm">{text("模板库", "Template library")}</span>→</Link><Link href="/generate" className="lift-card flex items-center gap-4 rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-5"><BirchIcon name="branch" size={23} /><span className="flex-1 text-sm">{text("创建职业文档", "Create career document")}</span>→</Link></div>
    {error && <p className="rounded-[12px] bg-[#EBE2CC] p-4 text-xs">{error}</p>}
    <Section title={text("最近文档", "Recent documents")} eyebrow={`${documents.length} ${text("份文档", "documents")}`}>
      {loading ? <div className="h-36 animate-pulse rounded-[16px] bg-[rgba(30,26,20,0.05)]" /> : documents.length === 0 ? <EmptyState icon="bark" title={text("还没有文档", "No documents yet")} description={text("生成职业材料或创建一份独立文档后，它会出现在这里。", "Generated career materials and standalone documents appear here.")} action={{ label: text("创建第一份文档", "Create your first document"), onClick: () => setCreating(true) }} /> : <div className="overflow-hidden rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0]">{documents.map((document, index) => <button type="button" onClick={() => void open(document)} key={document.id} className={`flex w-full items-center gap-4 p-4 text-left hover:bg-[#FDFAF3] ${index ? "border-t border-[rgba(30,26,20,0.12)]" : ""}`}><span className="flex size-9 items-center justify-center rounded-[6px] bg-[#EBE2CC]"><BirchIcon name="bark" size={18} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm">{document.title}</span><span className="mt-0.5 block text-[10px] text-[#7A6A50]">{new Date(document.updated_at).toLocaleDateString()} · v{document.version_count}</span></span><StatusPill tone={document.owner_module === "career" ? "brand" : "neutral"}>{document.kind.replace("_", " ")}</StatusPill><span aria-hidden="true">→</span></button>)}</div>}
    </Section>
  </WorkspacePage></>;
}
