"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import { BirchIcon } from "@/components/icons/BirchIcons";
import { EmptyState, Section, StatusPill, WorkspacePage } from "@/components/workspace/WorkspaceUI";
import { getHistory } from "@/lib/api";
import { useLanguage } from "@/lib/language-context";

interface DocumentRecord { id: number; timestamp: string; job_title: string; company: string; has_resume: boolean; has_cover_letter: boolean }

export default function DocumentsPage() {
  const { text } = useLanguage(); const [records, setRecords] = useState<DocumentRecord[]>([]); const [loading, setLoading] = useState(true);
  useEffect(() => { getHistory().then((result) => setRecords(result.records ?? [])).catch(() => setRecords([])).finally(() => setLoading(false)); }, []);
  const documents = records.flatMap((record) => [{ ...record, kind: "resume" as const, available: record.has_resume }, { ...record, kind: "cover" as const, available: record.has_cover_letter }]).filter((record) => record.available);
  return <><Header eyebrow={{ zh: "统一内容库", en: "UNIFIED CONTENT LIBRARY" }} title={{ zh: "文档", en: "Documents" }} subtitle={{ zh: "集中查看生成内容、上传文件、模板与未来的版本历史。", en: "Find generated content, uploaded files, templates, and future version history." }} action={<Link href="/generate" className="primary-button">{text("创建职业文档", "Create career document")}</Link>} /><WorkspacePage>
    <div className="grid gap-6 sm:grid-cols-2"><Link href="/templates" className="lift-card flex items-center gap-4 rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-5"><span className="flex size-11 items-center justify-center rounded-[6px] bg-[#EBE2CC]"><BirchIcon name="bark" size={23} /></span><span className="flex-1"><span className="block text-sm font-medium tracking-[0.1em]">{text("模板库", "Template library")}</span><span className="mt-1 block text-[10px] text-[#7A6A50]">{text("简历和文档结构", "Resume and document structures")}</span></span><span aria-hidden="true">→</span></Link><Link href="/career/applications" className="lift-card flex items-center gap-4 rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-5"><span className="flex size-11 items-center justify-center rounded-[6px] bg-[#EBE2CC]"><BirchIcon name="branch" size={23} /></span><span className="flex-1"><span className="block text-sm font-medium tracking-[0.1em]">{text("申请版本", "Application versions")}</span><span className="mt-1 block text-[10px] text-[#7A6A50]">{text("查看内容并下载 PDF", "Review content and download PDF")}</span></span><span aria-hidden="true">→</span></Link></div>
    <Section title={text("最近文档", "Recent documents")} eyebrow={`${documents.length} ${text("份可用文档", "available files")}`}>
      {loading ? <div className="h-36 animate-pulse rounded-[16px] bg-[rgba(30,26,20,0.05)]" /> : documents.length === 0 ? <EmptyState icon="bark" title={text("还没有文档", "No documents yet")} description={text("生成一份简历或求职信后，它会自动进入统一文档库。", "Generated resumes and cover letters will automatically appear in this library.")} action={{ label: text("创建第一份文档", "Create your first document"), href: "/generate" }} /> : <div className="overflow-hidden rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0]">{documents.slice(0, 12).map((document, index) => <Link key={`${document.id}-${document.kind}`} href="/career/applications" className={`flex items-center gap-4 p-4 hover:bg-[#FDFAF3] ${index ? "border-t border-[rgba(30,26,20,0.12)]" : ""}`}><span className="flex size-9 items-center justify-center rounded-[6px] bg-[#EBE2CC]"><BirchIcon name="bark" size={18} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm">{document.job_title} · {document.company}</span><span className="mt-0.5 block text-[10px] text-[#7A6A50]">{new Date(document.timestamp).toLocaleDateString()}</span></span><StatusPill tone={document.kind === "resume" ? "brand" : "neutral"}>{document.kind === "resume" ? text("简历", "Resume") : text("求职信", "Cover letter")}</StatusPill></Link>)}</div>}
    </Section>
  </WorkspacePage></>;
}
