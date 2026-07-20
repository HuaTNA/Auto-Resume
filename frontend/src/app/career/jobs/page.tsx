"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import { EmptyState, Section, StatusPill, WorkspacePage } from "@/components/workspace/WorkspaceUI";
import { AutomationJobResult, AutomationRun, listAutomations } from "@/lib/platform-api";
import { useLanguage } from "@/lib/language-context";

type SourceFilter = "all" | "indeed" | "adzuna";

export default function JobsPage() {
  const { text } = useLanguage();
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [source, setSource] = useState<SourceFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    listAutomations()
      .then((data) => setRuns(data.runs.filter((run) => run.result?.jobs?.length)))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Jobs could not be loaded"))
      .finally(() => setLoading(false));
  }, []);

  const jobs = useMemo(() => {
    const seen = new Set<string>();
    const results: AutomationJobResult[] = [];
    for (const run of runs) {
      for (const job of run.result?.jobs ?? []) {
        const key = job.job_id || `${job.source}|${job.url}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(job);
      }
    }
    return source === "all" ? results : results.filter((job) => job.source === source);
  }, [runs, source]);

  const warnings = useMemo(
    () => Array.from(new Set(runs.flatMap((run) => run.result?.source_warnings ?? []))),
    [runs],
  );

  return (
    <>
      <Header
        eyebrow={{ zh: "职业工作区", en: "CAREER WORKSPACE" }}
        title={{ zh: "职位", en: "Jobs" }}
        subtitle={{ zh: "聚合 Indeed 与 Adzuna 职位，并清楚保留每条结果的数据来源。", en: "Discover roles from Indeed and Adzuna with a visible source for every result." }}
        action={<Link href="/automations" className="primary-button">{text("配置搜索", "Configure search")}</Link>}
      />
      <WorkspacePage>
        {error && <p className="rounded-[12px] bg-[#EBE2CC] p-4 text-xs">{error}</p>}
        {warnings.map((warning) => <p key={warning} className="rounded-[12px] border border-[rgba(30,26,20,0.10)] bg-[#F5EFE0] p-3 text-[10px] text-[#7A6A50]">{text("数据源提示", "Source notice")}: {warning}</p>)}
        <Section
          title={text("搜索结果", "Search results")}
          eyebrow={loading ? "—" : `${jobs.length}`}
          action={
            <div className="flex gap-2">
              {(["all", "indeed", "adzuna"] as const).map((item) => (
                <button key={item} onClick={() => setSource(item)} className={`rounded-full px-3 py-1 text-[10px] capitalize ${source === item ? "bg-[#1E1A14] text-[#F5EFE0]" : "bg-[#EBE2CC] text-[#7A6A50]"}`}>{item}</button>
              ))}
            </div>
          }
        >
          {loading ? (
            <div className="grid gap-4 md:grid-cols-2">{[0, 1, 2, 3].map((item) => <div key={item} className="h-40 animate-pulse rounded-[16px] bg-[rgba(30,26,20,0.05)]" />)}</div>
          ) : jobs.length === 0 ? (
            <EmptyState icon="leaf" title={text("还没有职位结果", "No job results yet")} description={text("创建并运行一次职位搜索自动化，Indeed 和 Adzuna 结果会显示在这里。", "Create and run a job-search automation to populate results from Indeed and Adzuna.")} action={{ label: text("配置职位搜索", "Configure job search"), href: "/automations" }} />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {jobs.map((job, index) => (
                <article key={job.job_id || `${job.url}-${index}`} className="flex flex-col rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-medium">{job.title}</h3>
                      <p className="mt-1 text-xs text-[#7A6A50]">{job.company} · {job.location}</p>
                    </div>
                    {job.match_score > 0 && <StatusPill tone="brand">{job.match_score}%</StatusPill>}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <StatusPill tone={job.source === "indeed" ? "success" : "neutral"}>{sourceName(job.source)}</StatusPill>
                    {job.is_new && <StatusPill tone="success">New</StatusPill>}
                    {job.application_record_id && <StatusPill tone="neutral">Review</StatusPill>}
                  </div>
                  {job.match_reason && <p className="mt-3 line-clamp-2 text-[10px] leading-5 text-[#7A6A50]">{job.match_reason}</p>}
                  {salary(job) && <p className="mt-2 text-[10px] text-[#9A8468]">{salary(job)}</p>}
                  <div className="mt-auto pt-5">
                    <a href={job.url} target="_blank" rel="noreferrer" className="secondary-button inline-flex">{text(`在 ${sourceName(job.source)} 查看`, `View on ${sourceName(job.source)}`)} →</a>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Section>
      </WorkspacePage>
    </>
  );
}

function sourceName(source: string | undefined) {
  if (source === "indeed") return "Indeed";
  if (source === "adzuna") return "Adzuna";
  return source || "Unknown";
}

function salary(job: AutomationJobResult) {
  if (!job.salary_min && !job.salary_max) return "";
  const money = (value: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(value);
  if (job.salary_min && job.salary_max) return `${money(job.salary_min)} – ${money(job.salary_max)}`;
  return job.salary_min ? `${money(job.salary_min)}+` : `Up to ${money(job.salary_max as number)}`;
}
