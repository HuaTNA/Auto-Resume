"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import { BirchIcon } from "@/components/icons/BirchIcons";
import { CreatePanel, EmptyState, Section, StatusPill, WorkspacePage } from "@/components/workspace/WorkspaceUI";
import { createDocument, listDocuments, PlatformDocument } from "@/lib/platform-api";
import { useLanguage } from "@/lib/language-context";

export default function DocumentsPage() {
  const { text } = useLanguage();
  const [documents, setDocuments] = useState<PlatformDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

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

  return <><Header eyebrow={{ zh: "统一内容库", en: "UNIFIED CONTENT LIBRARY" }} title={{ zh: "文档", en: "Documents" }} subtitle={{ zh: "集中查看生成内容、独立文档与版本历史。", en: "Find generated content, standalone documents, and version history." }} action={<button onClick={() => setCreating(true)} className="primary-button">＋ {text("新建文档", "New document")}</button>} /><WorkspacePage>
    {creating && <CreatePanel title={text("新建文档", "Create a document")} onClose={() => setCreating(false)}><form onSubmit={submit} className="grid gap-4"><label className="text-xs">{text("标题", "Title")}<input name="title" required autoFocus className="mt-1.5 min-h-11 w-full px-3" /></label><label className="text-xs">{text("类型", "Type")}<select name="kind" className="mt-1.5 min-h-11 w-full px-3"><option value="note">{text("普通文档", "Document")}</option><option value="draft">{text("草稿", "Draft")}</option></select></label><label className="text-xs">{text("内容", "Content")}<textarea name="content" rows={7} className="mt-1.5 w-full px-3 py-2" /></label><button className="primary-button justify-self-start">{text("保存", "Save")}</button></form></CreatePanel>}
    <div className="grid gap-6 sm:grid-cols-2"><Link href="/templates" className="lift-card flex items-center gap-4 rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-5"><BirchIcon name="bark" size={23} /><span className="flex-1 text-sm">{text("模板库", "Template library")}</span>→</Link><Link href="/generate" className="lift-card flex items-center gap-4 rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-5"><BirchIcon name="branch" size={23} /><span className="flex-1 text-sm">{text("创建职业文档", "Create career document")}</span>→</Link></div>
    {error && <p className="rounded-[12px] bg-[#EBE2CC] p-4 text-xs">{error}</p>}
    <Section title={text("最近文档", "Recent documents")} eyebrow={`${documents.length} ${text("份文档", "documents")}`}>
      {loading ? <div className="h-36 animate-pulse rounded-[16px] bg-[rgba(30,26,20,0.05)]" /> : documents.length === 0 ? <EmptyState icon="bark" title={text("还没有文档", "No documents yet")} description={text("生成职业材料或创建一份独立文档后，它会出现在这里。", "Generated career materials and standalone documents appear here.")} action={{ label: text("创建第一份文档", "Create your first document"), onClick: () => setCreating(true) }} /> : <div className="overflow-hidden rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0]">{documents.map((document, index) => <article key={document.id} className={`flex items-center gap-4 p-4 ${index ? "border-t border-[rgba(30,26,20,0.12)]" : ""}`}><span className="flex size-9 items-center justify-center rounded-[6px] bg-[#EBE2CC]"><BirchIcon name="bark" size={18} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm">{document.title}</span><span className="mt-0.5 block text-[10px] text-[#7A6A50]">{new Date(document.updated_at).toLocaleDateString()} · v{document.version_count}</span></span><StatusPill tone={document.owner_module === "career" ? "brand" : "neutral"}>{document.kind.replace("_", " ")}</StatusPill></article>)}</div>}
    </Section>
  </WorkspacePage></>;
}
