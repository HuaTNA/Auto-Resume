"use client";

import { useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import { BirchIcon } from "@/components/icons/BirchIcons";
import { searchJobs } from "@/lib/api";
import { useLanguage } from "@/lib/language-context";

interface Job { title: string; company: string; location: string; description: string; url: string; salary_min: number | null; salary_max: number | null; created: string; match_score: number; match_reason: string }

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("canada");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [searched, setSearched] = useState(false);
  const { text } = useLanguage();
  const sourceUnavailable = error.includes("ADZUNA_APP_ID") || error.includes("ADZUNA_APP_KEY");

  async function handleSearch() {
    if (!query.trim()) return;
    setLoading(true); setError(""); setWarning(""); setSearched(true);
    try { const data = await searchJobs(query, location); setJobs(data.jobs); setWarning(data.ranking_warning ?? ""); }
    catch (e) { setError(e instanceof Error ? e.message : "Search failed"); }
    finally { setLoading(false); }
  }

  return (
    <>
      <Header eyebrow={{ zh: "机会 · 寻职", en: "OPPORTUNITY · SEARCH" }} title={{ zh: "寻觅合适的机会", en: "Find the right opportunity" }} subtitle={{ zh: "以你的真实经历为参照，辨认值得投入的岗位。", en: "Use your real experience to recognize roles worth pursuing." }} />
      <div className="mx-auto w-full max-w-[960px] space-y-8 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <section className="soft-card p-5 sm:p-6">
          <div className="mb-5 flex items-center gap-4">
            <span className="flex size-11 items-center justify-center rounded-[6px] bg-[#EBE2CC]"><BirchIcon name="bud" size={27} /></span>
            <div><p className="eyebrow text-[#9A8468]">{text("有意而寻", "Search with intention")}</p><h2 className="mt-1 text-lg font-normal tracking-[0.1em]">{text("从一个方向开始", "Begin with a direction")}</h2></div>
          </div>
          <div className="grid gap-3 md:grid-cols-[1.4fr_0.8fr_auto]">
            <label><span className="mb-1.5 block text-[11px] tracking-[0.08em] text-[#7A6A50]">{text("职位或关键词", "Role or keywords")}</span><input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSearch()} className="w-full px-4 py-3 text-sm" placeholder={text("例如：产品设计师", "e.g. Product Designer")} /></label>
            <label><span className="mb-1.5 block text-[11px] tracking-[0.08em] text-[#7A6A50]">{text("地域", "Location")}</span><select value={location} onChange={(e) => setLocation(e.target.value)} className="w-full px-4 py-3 text-sm"><option value="canada">Canada</option><option value="us">United States</option><option value="uk">United Kingdom</option><option value="australia">Australia</option><option value="germany">Germany</option></select></label>
            <button onClick={handleSearch} disabled={loading || !query.trim()} className="primary-button self-end px-8 disabled:translate-y-0 disabled:opacity-50">{loading ? text("寻觅中…", "Searching…") : text("开始寻职", "Search")}</button>
          </div>
        </section>

        {error && (sourceUnavailable ? <section className="rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#EBE2CC] p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[6px] bg-[#F5EFE0]"><BirchIcon name="root" size={23} /></span>
            <div className="min-w-0 flex-1">
              <p className="eyebrow text-[#9A8468]">{text("数据源状态", "Source status")}</p>
              <h2 className="mt-1 text-base font-medium tracking-[0.1em]">{text("职位搜索数据源尚未连接", "Job search source is not connected")}</h2>
              <p className="mt-2 text-xs leading-6 text-[#7A6A50]">{text("在线搜索需要在后端安全配置 Adzuna API 凭证。密钥不会保存在浏览器中。你仍然可以手动粘贴职位描述并继续生成定制材料。", "Online search requires Adzuna API credentials configured securely on the backend. Keys are never stored in the browser. You can still paste a job description and continue creating tailored materials.")}</p>
              <Link href="/generate" className="secondary-button mt-4">{text("手动导入职位描述", "Import a job description")}</Link>
            </div>
          </div>
        </section> : <div className="rounded-[6px] border border-[rgba(30,26,20,0.12)] bg-[#EBE2CC] p-4 text-sm text-[#1E1A14]">
          <p>{text("搜索暂时不可用，请稍后再试。", "Search is temporarily unavailable. Please try again later.")}</p>
          <p className="mt-2 text-xs text-[#7A6A50]">{error}</p>
        </div>)}

        {warning && <div className="flex items-start gap-3 rounded-[12px] border border-[rgba(30,26,20,0.10)] bg-[#EBE2CC] px-4 py-3 text-xs text-[#1E1A14]">
          <BirchIcon name="growth-ring" size={18} className="mt-0.5 shrink-0" />
          <div><p className="font-medium tracking-[0.08em]">{text("AI 匹配暂不可用", "AI matching is temporarily unavailable")}</p><p className="mt-1 leading-5 text-[#7A6A50]">{text("已为你显示来自职位数据源的原始结果；恢复后会重新提供匹配分数。", "Showing original results from the job source. Match scores will return when AI ranking is available.")}</p></div>
        </div>}

        {loading && <div className="flex flex-col items-center justify-center py-20"><div className="mb-6 size-10 animate-pulse rounded-[6px] bg-[#1E1A14]" /><p className="latin text-sm italic text-[#7A6A50]">Reading the landscape…</p></div>}

        {!loading && searched && jobs.length === 0 && !error && <div className="py-20 text-center"><BirchIcon name="winter" size={48} className="mx-auto opacity-50" /><p className="mt-5 text-sm text-[#7A6A50]">{text("暂未找到合适结果，换一个关键词再试。", "No suitable results yet. Try another keyword.")}</p></div>}

        {!loading && jobs.length > 0 && <div><div className="mb-5 flex items-end justify-between"><div><p className="eyebrow text-[#9A8468]">Found · {jobs.length}</p><h2 className="mt-1 text-xl tracking-[0.1em]">{text("可细读的机会", "Opportunities worth reviewing")}</h2></div><div className="ornament-divider" aria-hidden="true"><span /></div></div><div className="space-y-5">
          {jobs.map((job, i) => (
            <article key={`${job.company}-${job.title}-${i}`} className="soft-card lift-card p-6">
              <div className="flex flex-col justify-between gap-5 md:flex-row md:items-start">
                <div className="flex gap-4"><span className="flex size-12 shrink-0 items-center justify-center rounded-[6px] bg-[#EBE2CC] text-lg">{job.company.charAt(0).toUpperCase()}</span><div><h3 className="text-lg font-normal tracking-[0.06em]">{job.title}</h3><p className="mt-1 text-sm text-[#7A6A50]">{job.company} · {job.location}</p>{job.salary_min && job.salary_max && <p className="latin mt-1 text-xs text-[#9A8468]">${job.salary_min.toLocaleString()} — ${job.salary_max.toLocaleString()}</p>}</div></div>
                <div className="rounded-[6px] border border-[rgba(30,26,20,0.12)] bg-[#EBE2CC] px-3 py-2 text-center"><p className="latin text-[9px] uppercase tracking-[0.22em] text-[#9A8468]">Match</p><p className="latin text-xl font-normal text-[#1E1A14]">{job.match_score > 0 ? `${job.match_score}%` : "—"}</p></div>
              </div>
              <p className="mt-5 line-clamp-2 text-sm leading-7 text-[#7A6A50]">{job.description}</p><p className="latin mt-2 text-sm italic leading-6 text-[#9A8468]">{job.match_score > 0 ? job.match_reason : text("暂未进行 AI 匹配排序", "AI match ranking not available yet")}</p>
              <div className="mt-5 flex items-center justify-between border-t border-[rgba(30,26,20,0.12)] pt-4"><span className="latin text-[10px] tracking-[0.14em] text-[#9A8468]">{job.created?.slice(0, 10)}</span><a href={job.url} target="_blank" rel="noopener noreferrer" className="secondary-button min-h-10 py-1.5">{text("查看职位", "View job")} <span aria-hidden="true">↗</span></a></div>
            </article>
          ))}
        </div></div>}
      </div>
    </>
  );
}
