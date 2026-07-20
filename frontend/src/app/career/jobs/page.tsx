"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import { EmptyState, Section, StatusPill, WorkspacePage } from "@/components/workspace/WorkspaceUI";
import { AutomationJobResult, AutomationRun, generateJobMaterials, listAutomations } from "@/lib/platform-api";
import { useLanguage } from "@/lib/language-context";

type SourceFilter = "all" | "indeed" | "adzuna";

export default function JobsPage() {
  const { text } = useLanguage();
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [source, setSource] = useState<SourceFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState("");

  useEffect(() => {
    listAutomations()
      .then((data) => setRuns(data.runs.filter((run) => run.result?.jobs?.length)))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Jobs could not be loaded"))
      .finally(() => setLoading(false));
  }, []);

  const allJobs = useMemo(() => {
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
    return results;
  }, [runs]);

  const jobs = useMemo(
    () => source === "all" ? allJobs : allJobs.filter((job) => job.source === source),
    [allJobs, source],
  );

  const warnings = useMemo(
    () => Array.from(new Set(runs.flatMap((run) => run.result?.source_warnings ?? []))),
    [runs],
  );

  function toggleJob(jobId: string) {
    setSelected((items) => items.includes(jobId) ? items.filter((id) => id !== jobId) : [...items, jobId]);
  }

  async function generateSelected() {
    if (selected.length === 0 || generating) return;
    if (!confirm(text(`为选中的 ${selected.length} 个职位生成定制简历和求职信？`, `Generate a tailored resume and cover letter for ${selected.length} selected job(s)?`))) return;
    setGenerating(true);
    setError("");
    const failed: string[] = [];
    for (const [index, jobId] of selected.entries()) {
      const job = allJobs.find((item) => item.job_id === jobId);
      setProgress(text(`正在生成 ${index + 1}/${selected.length}：${job?.title || "职位"}`, `Generating ${index + 1}/${selected.length}: ${job?.title || "job"}`));
      try {
        const result = await generateJobMaterials(jobId);
        setRuns((items) => items.map((run) => run.result ? {
          ...run,
          result: {
            ...run.result,
            jobs: run.result.jobs?.map((item) => item.job_id === jobId ? { ...item, application_record_id: result.application_record_id, materials_generated: true } : item),
          },
        } : run));
      } catch (reason) {
        failed.push(jobId);
        setError(reason instanceof Error ? reason.message : "Material generation failed");
      }
    }
    setSelected(failed);
    setProgress(failed.length > 0 ? text(`${failed.length} 个职位生成失败，可重试。`, `${failed.length} job(s) failed and remain selected for retry.`) : text("材料已生成，可前往申请页面查看。", "Materials are ready in Applications."));
    setGenerating(false);
  }

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
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="flex gap-2">
                {(["all", "indeed", "adzuna"] as const).map((item) => (
                  <button key={item} onClick={() => setSource(item)} className={`rounded-[6px] px-3 py-1 text-[10px] capitalize ${source === item ? "bg-[#1E1A14] text-[#F5EFE0]" : "bg-[#EBE2CC] text-[#7A6A50]"}`}>{item}</button>
                ))}
              </div>
              <button onClick={generateSelected} disabled={selected.length === 0 || generating} className="primary-button min-h-9 px-3 py-1 text-[10px] disabled:opacity-40">
                {generating ? text("生成中…", "Generating…") : text(`生成材料 (${selected.length})`, `Generate materials (${selected.length})`)}
              </button>
            </div>
          }
        >
          {progress && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[rgba(30,26,20,0.10)] bg-[#EBE2CC] p-3 text-xs"><span>{progress}</span>{!generating && selected.length === 0 && <Link href="/career/applications" className="underline underline-offset-4">{text("查看申请与材料", "View applications and materials")} →</Link>}</div>}
          {loading ? (
            <div className="grid gap-4 md:grid-cols-2">{[0, 1, 2, 3].map((item) => <div key={item} className="h-40 animate-pulse rounded-[16px] bg-[rgba(30,26,20,0.05)]" />)}</div>
          ) : jobs.length === 0 ? (
            <EmptyState icon="leaf" title={text("还没有职位结果", "No job results yet")} description={text("创建并运行一次职位搜索自动化，Indeed 和 Adzuna 结果会显示在这里。", "Create and run a job-search automation to populate results from Indeed and Adzuna.")} action={{ label: text("配置职位搜索", "Configure job search"), href: "/automations" }} />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {jobs.map((job, index) => (
                <article key={job.job_id || `${job.url}-${index}`} className={`flex flex-col rounded-[16px] border bg-[#F5EFE0] p-5 ${job.job_id && selected.includes(job.job_id) ? "border-[#1E1A14] shadow-[0_0_0_1px_#1E1A14]" : "border-[rgba(30,26,20,0.12)]"}`}>
                  <label className="mb-3 flex w-fit items-center gap-2 text-[10px] text-[#7A6A50]">
                    <input
                      type="checkbox"
                      checked={Boolean(job.job_id && selected.includes(job.job_id))}
                      disabled={!job.job_id || job.materials_generated || generating}
                      onChange={() => job.job_id && toggleJob(job.job_id)}
                    />
                    <span>{job.materials_generated ? text("材料已生成", "Materials generated") : text("选择生成材料", "Select for materials")}</span>
                  </label>
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
                    {job.materials_generated && <StatusPill tone="brand">Materials ready</StatusPill>}
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
