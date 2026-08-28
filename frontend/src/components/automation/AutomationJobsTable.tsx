import Link from "next/link";
import { StatusPill } from "@/components/workspace/WorkspaceUI";
import type { AutomationJobResult } from "@/lib/platform-api";

interface Props {
  jobs: AutomationJobResult[];
  text: (zh: string, en: string) => string;
}

export default function AutomationJobsTable({ jobs, text }: Props) {
  return (
    <>
      <p className="mt-4 text-[10px] text-[#64736C] md:hidden">{text("左右滑动查看完整表格", "Swipe horizontally to view the full table")}</p>
      <div className="mt-2 overflow-x-auto rounded-[10px] border border-[rgba(38,51,47,0.10)] bg-[#FCFDFB] md:mt-4">
        <table className="w-full min-w-[920px] border-collapse text-left">
          <thead className="bg-[#E1EAE5] text-[10px] uppercase tracking-[0.12em] text-[#52645C]">
            <tr>
              <th scope="col" className="w-[25%] px-4 py-3 font-medium">{text("职位", "Position")}</th>
              <th scope="col" className="w-[18%] px-4 py-3 font-medium">{text("公司与地点", "Company & location")}</th>
              <th scope="col" className="w-[10%] px-4 py-3 text-center font-medium">{text("匹配度", "Match")}</th>
              <th scope="col" className="w-[20%] px-4 py-3 font-medium">{text("状态", "Status")}</th>
              <th scope="col" className="px-4 py-3 font-medium">{text("匹配理由", "Why it matches")}</th>
              <th scope="col" className="w-14 px-4 py-3"><span className="sr-only">{text("操作", "Action")}</span></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job, index) => (
              <tr key={`${job.company}-${job.title}-${index}`} className="border-t border-[rgba(38,51,47,0.10)] align-top transition-colors hover:bg-[#F8FAF8]">
                <td className="px-4 py-4"><p className="text-xs font-medium leading-5">{job.title}</p><div className="flex flex-wrap gap-1"><StatusPill tone={job.source === "indeed" ? "success" : "neutral"}>{job.source === "indeed" ? "Indeed" : job.source === "adzuna" ? "Adzuna" : job.source}</StatusPill>{job.search_query && <StatusPill tone="neutral">{job.search_query}</StatusPill>}</div></td>
                <td className="px-4 py-4"><p className="text-xs leading-5">{job.company}</p><p className="mt-1 text-[10px] leading-5 text-[#52645C]">{job.location}</p></td>
                <td className="px-4 py-4 text-center">{job.match_score > 0 ? <StatusPill tone="brand">{job.match_score}%</StatusPill> : <span className="text-[#64736C]">—</span>}</td>
                <td className="px-4 py-4"><div className="flex flex-wrap gap-1.5">{job.is_new && <StatusPill tone="success">{text("新增", "New")}</StatusPill>}{job.application_record_id && <StatusPill tone="neutral">{text("待审核", "Review")}</StatusPill>}{job.materials_generated && <StatusPill tone="brand">{text("材料已生成", "Materials ready")}</StatusPill>}{!job.is_new && !job.application_record_id && !job.materials_generated && <span className="text-[10px] text-[#64736C]">—</span>}</div></td>
                <td className="px-4 py-4"><p className="line-clamp-3 text-[10px] leading-5 text-[#52645C]">{job.match_reason || "—"}</p>{job.generation_warning && <p className="mt-1 text-[9px] leading-4 text-[#64736C]">{job.generation_warning}</p>}</td>
                <td className="px-4 py-4 text-right"><a href={job.url} target="_blank" rel="noreferrer" aria-label={text(`查看 ${job.title}`, `View ${job.title}`)} className="text-xs underline decoration-[#839A90] underline-offset-4">{text("查看", "View")}</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Link href="/career/jobs" className="secondary-button mt-4 inline-flex">{text("选择职位并生成材料", "Select jobs and generate materials")} →</Link>
    </>
  );
}
