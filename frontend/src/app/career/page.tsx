"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import ApplicationRecords from "@/components/career/ApplicationRecords";
import { BirchIcon, type BirchIconName } from "@/components/icons/BirchIcons";
import { Section, WorkspacePage } from "@/components/workspace/WorkspaceUI";
import { getHistory } from "@/lib/api";
import { useLanguage } from "@/lib/language-context";

interface CareerRecord {
  id: number;
  timestamp: string;
  job_title: string;
  company: string;
  status: string;
  match_score: number;
  has_resume: boolean;
  ats_scores: { overall: number | null };
}

const PIPELINE = ["generated", "applied", "interview", "offer"] as const;

export default function CareerPage() {
  const { text } = useLanguage();
  const [records, setRecords] = useState<CareerRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getHistory()
      .then((result) => setRecords(result.records ?? []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, []);

  const active = records.filter((record) => ["generated", "applied", "interview"].includes(record.status));
  const interviewCount = records.filter((record) => record.status === "interview").length;
  const atsScores = records.filter((record) => record.has_resume).map((record) => record.ats_scores.overall).filter((score): score is number => score != null);
  const matchScores = records.map((record) => record.match_score).filter((score) => score > 0);
  const averageAts = atsScores.length ? Math.round(atsScores.reduce((total, score) => total + score, 0) / atsScores.length) : null;
  const averageMatch = matchScores.length ? Math.round(matchScores.reduce((total, score) => total + score, 0) / matchScores.length) : null;
  const latest = records[0];

  const nextMove = useMemo(() => {
    const interview = records.find((record) => record.status === "interview");
    if (interview) return {
      icon: "leaf" as BirchIconName,
      eyebrow: text("最值得投入", "Highest leverage"),
      title: text(`准备 ${interview.company} 的面试`, `Prepare for ${interview.company}`),
      detail: text("把职位要求、经历故事和你的提问整理到同一个面试语境中。", "Bring role requirements, experience stories, and your questions into one interview context."),
      href: "/career/interview",
      action: text("开始准备", "Start preparing"),
    };
    const generated = records.find((record) => record.status === "generated");
    if (generated) return {
      icon: "bud" as BirchIconName,
      eyebrow: text("等待行动", "Ready for action"),
      title: text(`检查并投递 ${generated.company}`, `Review and apply to ${generated.company}`),
      detail: text("材料已经生成。完成最后一次人工检查，然后把申请推进到下一阶段。", "Your materials are ready. Give them one final human review, then move the application forward."),
      href: "/career/applications",
      action: text("查看申请", "Review application"),
    };
    return {
      icon: "branch" as BirchIconName,
      eyebrow: text("从这里开始", "A place to begin"),
      title: text("找到一个真正值得投入的机会", "Find one opportunity worth your attention"),
      detail: text("先寻找一个与你经历相符的职位，再决定是否为它定制材料。", "Start with a role that fits your experience, then decide whether it deserves tailored materials."),
      href: "/search",
      action: text("发现机会", "Discover roles"),
    };
  }, [records, text]);

  const primaryTools: Array<{ href: string; icon: BirchIconName; title: string; detail: string; meta: string; tone: "light" | "warm" | "dark" }> = [
    { href: "/search", icon: "bud", title: text("职位与匹配", "Jobs & Match"), detail: text("寻找、判断并保存值得投入的职位。", "Find, assess, and save roles worth your time."), meta: text("发现", "DISCOVER"), tone: "warm" },
    { href: "/generate", icon: "branch", title: text("简历工作室", "Resume Studio"), detail: text("生成定制材料并提升 ATS 表现。", "Tailor your materials and improve ATS performance."), meta: averageAts == null ? text("待生成", "READY") : `ATS ${averageAts}%`, tone: "dark" },
    { href: "/career/applications", icon: "bark", title: text("申请追踪", "Applications"), detail: text("查看状态、版本、文档与下一步。", "See status, versions, documents, and next steps."), meta: text(`${active.length} 项活跃`, `${active.length} ACTIVE`), tone: "light" },
  ];

  return <>
    <Header eyebrow={{ zh: "职业工作区", en: "CAREER WORKSPACE" }} title={{ zh: "职业", en: "Career" }} subtitle={{ zh: "你正在推进的机会、材料与下一步。", en: "The opportunities, materials, and next moves currently in motion." }} action={<Link href="/search" className="primary-button">{text("寻找机会", "Find opportunities")}<span aria-hidden="true">→</span></Link>} />
    <WorkspacePage>
      <section className="relative overflow-hidden rounded-[14px] bg-[#1E1A14] px-6 py-7 text-[#F5EFE0] shadow-[0_16px_48px_rgba(30,26,20,0.16)] sm:px-8 sm:py-9">
        <BirchIcon name="branch" size={220} className="pointer-events-none absolute -bottom-20 -right-6 opacity-[0.07] brightness-[4]" />
        <div className="relative grid gap-8 lg:grid-cols-[1.25fr_0.75fr] lg:items-end">
          <div>
            <p className="latin text-[9px] uppercase tracking-[0.34em] text-[#B8A98A]">Your career · in motion</p>
            <h2 className="latin mt-4 max-w-2xl text-[2rem] font-normal leading-[1.2] tracking-[0.03em] sm:text-[2.55rem]">
              {active.length > 0
                ? text(`你有 ${active.length} 个机会正在向前推进。`, `${active.length} opportunities are moving forward.`)
                : text("下一段职业路径，从一个值得的机会开始。", "The next chapter starts with one worthwhile opportunity.")}
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-[#B8A98A]">
              {latest
                ? text(`最近更新：${latest.company} · ${latest.job_title}`, `Latest: ${latest.company} · ${latest.job_title}`)
                : text("寻找机会、定制材料、跟进申请，并把每一步沉淀进职业档案。", "Discover roles, tailor materials, track applications, and keep every step in your career record.")}
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <Link href={nextMove.href} className="inline-flex min-h-10 items-center gap-2 rounded-[6px] bg-[#F5EFE0] px-4 text-xs text-[#1E1A14]"><BirchIcon name={nextMove.icon} size={15} />{nextMove.action}</Link>
              <Link href="/career/applications" className="inline-flex min-h-10 items-center gap-2 rounded-[6px] border border-[rgba(245,239,224,0.24)] bg-[rgba(245,239,224,0.08)] px-4 text-xs text-[#F5EFE0]">{text("申请看板", "Application board")}<span aria-hidden="true">→</span></Link>
            </div>
          </div>

          <div className="rounded-[12px] border border-[rgba(245,239,224,0.15)] bg-[rgba(245,239,224,0.07)] p-4">
            <p className="latin text-[9px] uppercase tracking-[0.3em] text-[#B8A98A]">Career pulse</p>
            <div className="mt-4 grid grid-cols-3 divide-x divide-[rgba(245,239,224,0.14)]">
              <PulseValue value={loading ? "—" : String(active.length)} label={text("活跃申请", "Active")} />
              <PulseValue value={loading ? "—" : String(interviewCount)} label={text("面试", "Interviews")} />
              <PulseValue value={loading ? "—" : averageMatch == null ? "—" : `${averageMatch}%`} label={text("平均匹配", "Avg match")} />
            </div>
            <div className="mt-5 h-1 overflow-hidden rounded-[4px] bg-[rgba(245,239,224,0.12)]"><span className="block h-full bg-[#B8A98A]" style={{ width: `${Math.min(100, active.length * 18 + interviewCount * 16)}%` }} /></div>
            <p className="mt-2 text-[9px] leading-4 text-[#9A8468]">{text("进度来自申请状态与材料记录。", "Pulse reflects application stages and material history.")}</p>
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-[12px] border border-[rgba(30,26,20,0.10)] bg-[#F5EFE0] p-5 shadow-[0_2px_8px_rgba(30,26,20,0.05)] sm:p-6">
          <div className="flex items-end justify-between gap-4"><div><p className="latin text-[9px] uppercase tracking-[0.32em] text-[#9A8468]">Application flow</p><h2 className="mt-1 text-lg font-medium tracking-[0.08em]">{text("申请进度", "Application pipeline")}</h2></div><Link href="/career/applications" className="text-xs underline decoration-[#B8A98A] underline-offset-4">{text("查看全部", "View all")} →</Link></div>
          <div className="mt-6 grid grid-cols-4 gap-2">
            {PIPELINE.map((status, index) => {
              const count = records.filter((record) => record.status === status).length;
              const labels = {
                generated: text("材料完成", "Prepared"),
                applied: text("已申请", "Applied"),
                interview: text("面试", "Interview"),
                offer: "Offer",
              };
              return <div key={status} className={`relative rounded-[8px] border border-[rgba(30,26,20,0.10)] px-3 py-4 ${index === 2 && count > 0 ? "bg-[#EBE2CC]" : "bg-[rgba(232,225,208,0.38)]"}`}>
                <p className="latin text-2xl leading-none text-[#1E1A14]">{loading ? "—" : count}</p>
                <p className="mt-2 text-[9px] leading-4 text-[#7A6A50]">{labels[status]}</p>
                {index < PIPELINE.length - 1 && <span className="absolute -right-2 top-1/2 z-10 text-[10px] text-[#B8A98A]" aria-hidden="true">→</span>}
              </div>;
            })}
          </div>
          <p className="mt-5 text-[11px] leading-5 text-[#7A6A50]">{text("让每个机会都有清楚的阶段；当状态变化时，这里会立即反映。", "Every opportunity has a visible stage. This view changes as your applications move forward.")}</p>
        </section>

        <section className="relative overflow-hidden rounded-[12px] border border-[rgba(30,26,20,0.10)] bg-[#EBE2CC] p-5 sm:p-6">
          <BirchIcon name={nextMove.icon} size={76} className="absolute -bottom-3 -right-2 opacity-[0.08]" />
          <div className="relative">
            <p className="latin text-[9px] uppercase tracking-[0.32em] text-[#9A8468]">{nextMove.eyebrow}</p>
            <h2 className="mt-3 text-lg font-medium leading-7 tracking-[0.06em]">{nextMove.title}</h2>
            <p className="mt-3 text-xs leading-6 text-[#7A6A50]">{nextMove.detail}</p>
            <Link href={nextMove.href} className="secondary-button mt-5 bg-[#F5EFE0]">{nextMove.action}<span aria-hidden="true">→</span></Link>
          </div>
        </section>
      </div>

      <Section title={text("工作流", "Career workflow")} eyebrow={text("按当前状态进入", "Enter where the work is")}>
        <div className="grid gap-4 md:grid-cols-3">
          {primaryTools.map((tool) => <CareerTool key={tool.href} {...tool} />)}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <QuietLink href="/profile" icon="growth-ring" label={text("职业档案", "Career Profile")} detail={text("经历与证据", "Experience & evidence")} />
          <QuietLink href="/career/interview" icon="leaf" label={text("面试准备", "Interview Prep")} detail={text("故事与复盘", "Stories & debriefs")} />
          <QuietLink href="/templates" icon="tree" label={text("文档模板", "Templates")} detail={text("可复用结构", "Reusable structures")} />
        </div>
      </Section>

      <Section title={text("最近申请", "Recent applications")} eyebrow={text("继续上次的工作", "Continue where you left off")} action={<Link href="/career/applications" className="text-xs text-[#1E1A14] underline decoration-[#B8A98A] underline-offset-4">{text("申请看板", "Application board")} →</Link>}>
        <ApplicationRecords limit={3} />
      </Section>

      <p className="latin text-center text-[9px] uppercase tracking-[0.26em] text-[#9A8468]">{text("每一次机会，都成为下一次判断的语境", "Every opportunity becomes context for the next decision")}</p>
    </WorkspacePage>
  </>;
}

function PulseValue({ value, label }: { value: string; label: string }) {
  return <div className="px-3 first:pl-0 last:pr-0"><p className="latin text-[1.65rem] leading-none text-[#F5EFE0]">{value}</p><p className="mt-2 text-[8px] uppercase tracking-[0.14em] text-[#9A8468]">{label}</p></div>;
}

function CareerTool({ href, icon, title, detail, meta, tone }: { href: string; icon: BirchIconName; title: string; detail: string; meta: string; tone: "light" | "warm" | "dark" }) {
  const styles = tone === "dark" ? "border-[#1E1A14] bg-[#1E1A14] text-[#F5EFE0]" : tone === "warm" ? "border-[rgba(30,26,20,0.10)] bg-[#EBE2CC] text-[#1E1A14]" : "border-[rgba(30,26,20,0.10)] bg-[#F5EFE0] text-[#1E1A14]";
  return <Link href={href} className={`lift-card group relative min-h-52 overflow-hidden rounded-[12px] border p-5 ${styles}`}>
    <div className="flex items-start justify-between gap-4"><span className={`flex size-10 items-center justify-center rounded-[6px] ${tone === "dark" ? "bg-[#F5EFE0]" : "bg-[#F5EFE0]"}`}><BirchIcon name={icon} size={23} /></span><span className={`latin text-[8px] uppercase tracking-[0.24em] ${tone === "dark" ? "text-[#B8A98A]" : "text-[#9A8468]"}`}>{meta}</span></div>
    <h3 className="mt-8 text-base font-medium tracking-[0.08em]">{title}</h3>
    <p className={`mt-2 text-xs leading-6 ${tone === "dark" ? "text-[#B8A98A]" : "text-[#7A6A50]"}`}>{detail}</p>
    <span className={`absolute bottom-5 right-5 transition-transform group-hover:translate-x-1 ${tone === "dark" ? "text-[#B8A98A]" : "text-[#9A8468]"}`} aria-hidden="true">→</span>
  </Link>;
}

function QuietLink({ href, icon, label, detail }: { href: string; icon: BirchIconName; label: string; detail: string }) {
  return <Link href={href} className="group flex items-center gap-3 rounded-[8px] border border-[rgba(30,26,20,0.10)] bg-[rgba(245,239,224,0.45)] px-4 py-3 hover:bg-[#F5EFE0]">
    <BirchIcon name={icon} size={17} /><span className="min-w-0 flex-1"><span className="block text-xs font-medium">{label}</span><span className="mt-0.5 block text-[9px] text-[#9A8468]">{detail}</span></span><span className="text-[#B8A98A] transition-transform group-hover:translate-x-1" aria-hidden="true">→</span>
  </Link>;
}
