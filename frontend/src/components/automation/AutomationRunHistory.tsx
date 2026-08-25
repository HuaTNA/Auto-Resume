"use client";

import { useState } from "react";
import AutomationJobsTable from "@/components/automation/AutomationJobsTable";
import type { AutomationJobResult, AutomationRun } from "@/lib/platform-api";

interface Props {
  runs: AutomationRun[];
  text: (zh: string, en: string) => string;
}

function localDateKey(value: string) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function uniqueJobs(runs: AutomationRun[]) {
  const jobs = new Map<string, AutomationJobResult>();
  [...runs]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .forEach((run) => run.result?.jobs?.forEach((job) => {
      const key = job.job_id || job.url || `${job.company}:${job.title}`;
      if (!jobs.has(key)) jobs.set(key, job);
    }));
  return [...jobs.values()].sort((a, b) => b.match_score - a.match_score);
}

export default function AutomationRunHistory({ runs, text }: Props) {
  const [activeDate, setActiveDate] = useState("");
  const dates = [...new Set(runs.map((run) => localDateKey(run.created_at)))].sort((a, b) => b.localeCompare(a));
  const selectedDate = dates.includes(activeDate) ? activeDate : dates[0];
  const selectedRuns = runs.filter((run) => localDateKey(run.created_at) === selectedDate);
  const jobs = uniqueJobs(selectedRuns);
  const completed = selectedRuns.filter((run) => run.status === "completed").length;
  const failedRuns = selectedRuns.filter((run) => run.status === "failed");

  function dateLabel(key: string) {
    const [year, month, day] = key.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return text(
      new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", year: "numeric" }).format(date),
      new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric" }).format(date),
    );
  }

  if (runs.length === 0) return <div className="rounded-[12px] border border-[rgba(38,51,47,0.10)] bg-[#F8FAF8] px-5 py-8 text-center text-sm text-[#52645C]">{text("还没有运行记录", "No run history yet")}</div>;

  return (
    <div className="overflow-hidden rounded-[16px] border border-[rgba(38,51,47,0.12)] bg-[#F8FAF8]">
      <div className="overflow-x-auto border-b border-[rgba(38,51,47,0.12)] px-4 pt-3">
        <div className="flex min-w-max gap-1" role="tablist" aria-label={text("按日期查看运行结果", "Run results by date")}>
          {dates.map((date) => {
            const active = date === selectedDate;
            const dayRuns = runs.filter((run) => localDateKey(run.created_at) === date);
            const jobCount = uniqueJobs(dayRuns).length;
            return <button key={date} type="button" role="tab" aria-selected={active} onClick={() => setActiveDate(date)} className={`min-h-10 border-b-2 px-3 text-xs transition-colors ${active ? "border-[#26332F] text-[#26332F]" : "border-transparent text-[#52645C] hover:bg-[#FCFDFB] hover:text-[#26332F]"}`}>{dateLabel(date)} <span className="ml-1 text-[9px] text-[#64736C]">{jobCount}</span></button>;
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(38,51,47,0.10)] px-5 py-3">
        <div><p className="text-sm font-medium tracking-[0.04em]">{dateLabel(selectedDate)}</p><p className="mt-0.5 text-[10px] text-[#52645C]">{text(`${selectedRuns.length} 次运行 · ${jobs.length} 个职位`, `${selectedRuns.length} runs · ${jobs.length} jobs`)}</p></div>
        <div className="flex gap-2 text-[10px]"><span className="rounded-[6px] bg-[#E1EAE5] px-2 py-1 text-[#52645C]">{completed} {text("成功", "completed")}</span>{failedRuns.length > 0 && <span className="rounded-[6px] border border-[rgba(38,51,47,0.12)] px-2 py-1">{failedRuns.length} {text("失败", "failed")}</span>}</div>
      </div>

      <div className="p-4 sm:p-5">
        {jobs.length > 0 ? <AutomationJobsTable jobs={jobs} text={text} /> : <div className="rounded-[10px] border border-[rgba(38,51,47,0.10)] bg-[#FCFDFB] px-5 py-10 text-center text-sm text-[#52645C]">{text("这一天没有职位结果", "No job results for this date")}</div>}
        {failedRuns.length > 0 && <details className="mt-4 rounded-[10px] border border-[rgba(38,51,47,0.10)] bg-[#FCFDFB] px-4 py-3"><summary className="cursor-pointer text-xs text-[#52645C]">{text(`查看 ${failedRuns.length} 条失败详情`, `View ${failedRuns.length} failure details`)}</summary><div className="mt-3 space-y-3">{failedRuns.map((run) => <div key={run.id} className="border-t border-[rgba(38,51,47,0.10)] pt-3 first:border-0 first:pt-0"><p className="text-[10px] text-[#64736C]">{new Date(run.created_at).toLocaleTimeString()} · {run.attempt_count} {text("次尝试", "attempts")}</p><p className="mt-1 max-h-28 overflow-y-auto break-words text-[10px] leading-5 text-[#52645C]">{run.error}</p></div>)}</div></details>}
      </div>
    </div>
  );
}
