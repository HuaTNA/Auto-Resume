"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import { BirchIcon, type BirchIconName } from "@/components/icons/BirchIcons";
import { getTemplates } from "@/lib/api";
import { useLanguage } from "@/lib/language-context";

interface Template { name: string; description: string; path: string; exists: boolean }
const PREVIEWS: Record<string, { icon: BirchIconName; index: string; features: Array<{ zh: string; en: string }> }> = {
  classic: { icon: "bark", index: "壹", features: [{ zh: "克制章法", en: "Measured layout" }, { zh: "标准页边", en: "Standard margins" }, { zh: "适合 ATS", en: "ATS friendly" }, { zh: "适配多数技术岗位", en: "For most technical roles" }] },
  modern: { icon: "leaf", index: "贰", features: [{ zh: "紧凑层次", en: "Compact hierarchy" }, { zh: "内容容量更大", en: "More content space" }, { zh: "阅读节奏清楚", en: "Clear reading rhythm" }, { zh: "适配创新岗位", en: "For innovative roles" }] },
  consulting: { icon: "growth-ring", index: "叁", features: [{ zh: "经历为先", en: "Experience first" }, { zh: "信息秩序严谨", en: "Rigorous structure" }, { zh: "技能收束于末", en: "Skills at the close" }, { zh: "适配咨询与管理", en: "For consulting & management" }] },
};

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const router = useRouter();
  const { text } = useLanguage();
  useEffect(() => { (async () => { try { setTemplates((await getTemplates()).templates); } catch (e) { setError(e instanceof Error ? e.message : "Failed to load templates"); } finally { setLoading(false); } })(); }, []);
  return <><Header eyebrow={{ zh: "文书 · 范式", en: "DOCUMENT FORMS · TEMPLATES" }} title={{ zh: "选择履历章法", en: "Choose a resume form" }} subtitle={{ zh: "形式应退后一步，让经历与判断成为主角。", en: "Let form recede so experience and judgment can lead." }} />
    <div className="mx-auto w-full max-w-[960px] px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
      <div className="mb-8 flex items-end justify-between gap-5"><div><p className="eyebrow text-[#9A8468]">{text("三种克制范式", "Three measured forms")}</p><h2 className="mt-2 text-2xl font-light tracking-[0.1em]">{text("一式，一种叙述秩序", "A form for every narrative")}</h2><p className="mt-3 max-w-xl text-sm leading-7 text-[#7A6A50]">{text("选择与你的经历密度和目标行业最相称的表达方式。", "Choose the expression that best fits your experience and target field.")}</p></div><div className="ornament-divider hidden sm:flex" aria-hidden="true"><span /></div></div>
      {loading ? <p className="py-16 text-center text-sm text-[#7A6A50]">正在展开范式…</p> : error ? <p className="rounded-[6px] bg-[#EBE2CC] p-5 text-center text-sm">{error}</p> : <div className="grid gap-5 md:grid-cols-3">{templates.map((template) => { const preview = PREVIEWS[template.name] ?? PREVIEWS.classic; return <article key={template.name} onClick={() => router.push(`/generate?template=${template.name}`)} className="soft-card lift-card group cursor-pointer overflow-hidden">
        <div className="relative flex min-h-48 flex-col items-center justify-center border-b border-[rgba(30,26,20,0.12)] bg-[#EBE2CC] p-7 text-center"><span className="latin absolute left-5 top-4 text-2xl italic text-[#B8A98A]">{preview.index}</span>{template.name === "classic" && <span className="absolute right-4 top-4 rounded-[6px] border border-[rgba(30,26,20,0.12)] px-2 py-1 text-[9px] tracking-[0.15em] text-[#7A6A50]">{text("默认", "Default")}</span>}<BirchIcon name={preview.icon} size={58} /><h3 className="latin mt-5 text-xl font-normal capitalize tracking-[0.12em]">{template.name}</h3></div>
        <div className="p-6"><p className="min-h-14 text-sm leading-7 text-[#7A6A50]">{template.description}</p><ul className="mt-5 space-y-2.5">{preview.features.map((feature) => <li key={feature.en} className="flex items-center gap-3 text-xs text-[#7A6A50]"><span className="size-1 rounded-full bg-[#B8A98A]" />{text(feature.zh, feature.en)}</li>)}</ul><button className="primary-button mt-7 w-full">{text("采用此式", "Use this form")} <span aria-hidden="true">→</span></button></div>
      </article>; })}</div>}
    </div></>;
}
