import { AutomationRun } from "@/lib/platform-api";

interface Props {
  runs: AutomationRun[];
  text: (zh: string, en: string) => string;
}

const count = (run: AutomationRun, key: string) => Number(run.counts[key] ?? 0);

export default function AutomationInsights({ runs, text }: Props) {
  const recentRuns = [...runs]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(-8);
  const completed = runs.filter((run) => run.status === "completed").length;
  const failed = runs.filter((run) => run.status === "failed").length;
  const finished = completed + failed;
  const successRate = finished > 0 ? Math.round((completed / finished) * 100) : 0;
  const totals = runs.reduce(
    (summary, run) => ({
      found: summary.found + count(run, "found"),
      newJobs: summary.newJobs + count(run, "new_jobs"),
      applications: summary.applications + count(run, "applications"),
      materials: summary.materials + count(run, "materials"),
    }),
    { found: 0, newJobs: 0, applications: 0, materials: 0 },
  );
  const maxTrend = Math.max(1, ...recentRuns.map((run) => Math.max(count(run, "found"), count(run, "new_jobs"))));
  const funnel = [
    { label: text("发现职位", "Jobs found"), value: totals.found },
    { label: text("新增机会", "New opportunities"), value: totals.newJobs },
    { label: text("待审核", "Ready to review"), value: totals.applications },
    { label: text("材料已生成", "Materials created"), value: totals.materials },
  ];
  const maxFunnel = Math.max(1, ...funnel.map((item) => item.value));

  if (runs.length === 0) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
      <figure className="rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-5 sm:p-6">
        <figcaption className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium tracking-[0.06em]">{text("近期运行产出", "Recent run output")}</p>
            <p className="mt-1 text-[10px] text-[#7A6A50]">{text("最近 8 次运行 · 发现与新增职位", "Last 8 runs · found and new jobs")}</p>
          </div>
          <div className="flex gap-4 text-[10px] text-[#7A6A50]">
            <span className="flex items-center gap-1.5"><i className="block size-2 bg-[#1E1A14]" />{text("发现", "Found")}</span>
            <span className="flex items-center gap-1.5"><i className="block size-2 bg-[#B8A98A]" />{text("新增", "New")}</span>
          </div>
        </figcaption>
        <div className="mt-6 flex h-44 items-end gap-2 border-b border-[rgba(30,26,20,0.12)] px-1" role="img" aria-label={text("各次自动化运行发现和新增职位数量柱状图", "Bar chart of found and new jobs by automation run")}>
          {recentRuns.map((run) => {
            const found = count(run, "found");
            const newJobs = count(run, "new_jobs");
            return (
              <div key={run.id} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                <div className="flex h-[136px] items-end justify-center gap-1">
                  <div title={`${text("发现", "Found")}: ${found}`} className="w-[38%] min-w-1 bg-[#1E1A14]" style={{ height: found === 0 ? 2 : `${Math.max(8, (found / maxTrend) * 100)}%` }} />
                  <div title={`${text("新增", "New")}: ${newJobs}`} className="w-[38%] min-w-1 bg-[#B8A98A]" style={{ height: newJobs === 0 ? 2 : `${Math.max(8, (newJobs / maxTrend) * 100)}%` }} />
                </div>
                <span className="mt-2 truncate text-center text-[9px] text-[#9A8468]">{new Date(run.created_at).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}</span>
              </div>
            );
          })}
        </div>
      </figure>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <article className="rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-5">
          <div className="flex items-end justify-between gap-4">
            <div><p className="text-[10px] uppercase tracking-[0.16em] text-[#7A6A50]">{text("运行成功率", "Run success rate")}</p><p className="latin mt-2 text-4xl leading-none">{successRate}<span className="text-base">%</span></p></div>
            <p className="text-right text-[10px] leading-5 text-[#7A6A50]">{completed} {text("成功", "completed")}<br />{failed} {text("失败", "failed")}</p>
          </div>
          <div className="mt-5 flex h-2 overflow-hidden rounded-[6px] bg-[#EBE2CC]" aria-hidden="true"><span className="bg-[#1E1A14]" style={{ width: `${successRate}%` }} /></div>
        </article>
        <article className="rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-5">
          <p className="text-[10px] uppercase tracking-[0.16em] text-[#7A6A50]">{text("累计成果漏斗", "Cumulative outcome funnel")}</p>
          <div className="mt-4 space-y-3">
            {funnel.map((item) => <div key={item.label}><div className="mb-1 flex items-center justify-between gap-3 text-[10px]"><span className="text-[#7A6A50]">{item.label}</span><span>{item.value}</span></div><div className="h-1.5 bg-[#EBE2CC]"><div className="h-full bg-[#B8A98A]" style={{ width: `${(item.value / maxFunnel) * 100}%` }} /></div></div>)}
          </div>
        </article>
      </div>
    </div>
  );
}
