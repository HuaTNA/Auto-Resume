"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Header from "@/components/Header";
import { BirchIcon, type BirchIconName } from "@/components/icons/BirchIcons";
import { WorkspacePage } from "@/components/workspace/WorkspaceUI";
import { getProfileCompleteness } from "@/lib/api";
import { useLanguage } from "@/lib/language-context";

interface ProfileReadiness {
  blocking: string[];
  warnings: string[];
}

const EMPTY_READINESS: ProfileReadiness = { blocking: [], warnings: [] };

export default function FirstRunExperience() {
  const { text } = useLanguage();
  const [readiness, setReadiness] = useState<ProfileReadiness>(EMPTY_READINESS);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    getProfileCompleteness()
      .then((result) => setReadiness({
        blocking: Array.isArray(result.blocking) ? result.blocking : [],
        warnings: Array.isArray(result.warnings) ? result.warnings : [],
      }))
      .catch(() => setUnavailable(true))
      .finally(() => setLoading(false));
  }, []);

  const profileReady = !loading && !unavailable && readiness.blocking.length === 0;
  const primaryHref = profileReady ? "/generate" : "/profile";
  const primaryLabel = profileReady
    ? text("粘贴职位描述", "Paste a job description")
    : text("先完善职业档案", "Complete your career profile");

  return (
    <>
      <Header
        eyebrow={{ zh: "从一次明确成果开始", en: "START WITH A CLEAR OUTCOME" }}
        title={{ zh: "生成第一份定制简历", en: "Create your first tailored resume" }}
        subtitle={{ zh: "先完成一份可以投递的材料，再决定是否扩展整个工作区。", en: "Create something ready to use before expanding the rest of your workspace." }}
      />
      <WorkspacePage>
        <section className="relative overflow-hidden rounded-[16px] bg-[#1E1A14] px-6 py-8 text-[#F5EFE0] shadow-[0_20px_60px_rgba(30,26,20,0.18)] sm:px-9 sm:py-10 lg:px-12 lg:py-12">
          <div className="relative z-10 max-w-[720px]">
            <p className="eyebrow text-[#B8A98A]">Resume · Evidence · Control</p>
            <h2 className="mt-4 max-w-2xl text-[2rem] font-normal leading-[1.35] tracking-[0.06em] sm:text-[2.65rem]">
              {text("把一个职位描述，变成一份可信、可投递的定制简历。", "Turn one job description into a credible, application-ready resume.")}
            </h2>
            <p className="mt-5 max-w-xl text-[15px] leading-7 text-[#F5EFE0]">
              {text("桦只从你的真实经历中取材。你保留最终决定权，并能在提交前检查每一份材料。", "Hua only works from your real experience. You keep final control and review every document before using it.")}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href={primaryHref} className="inline-flex min-h-11 items-center gap-2 rounded-[6px] bg-[#F5EFE0] px-5 text-sm font-medium text-[#1E1A14] shadow-sm hover:bg-[#FDFAF3]">
                <BirchIcon name={profileReady ? "bark" : "growth-ring"} size={18} />
                {primaryLabel}<span aria-hidden="true">→</span>
              </Link>
              <Link href="/search" className="inline-flex min-h-11 items-center gap-2 rounded-[6px] border border-[rgba(249,245,234,0.28)] px-5 text-sm text-[#F5EFE0] hover:bg-[rgba(249,245,234,0.08)]">
                {text("先寻找职位", "Find a role first")}
              </Link>
            </div>
          </div>
          <BirchIcon name="branch" size={260} className="pointer-events-none absolute -bottom-16 -right-10 opacity-[0.055]" />
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <JourneyStep
            number="01"
            icon="growth-ring"
            title={text("整理真实经历", "Prepare your evidence")}
            description={profileReady
              ? text("职业档案已经具备生成条件。", "Your career profile is ready for generation.")
              : text("补充一段经历或项目，以及至少一条成果证据。", "Add an experience or project and at least one evidence bullet.")}
            state={loading ? "loading" : profileReady ? "done" : "current"}
            href="/profile"
          />
          <JourneyStep
            number="02"
            icon="leaf"
            title={text("加入职位描述", "Add the role")}
            description={text("粘贴完整 JD，让要求与真实经历一一对应。", "Paste the full JD so its requirements can be matched to your real experience.")}
            state={profileReady ? "current" : "next"}
            href="/generate"
          />
          <JourneyStep
            number="03"
            icon="bark"
            title={text("审核并下载", "Review and download")}
            description={text("检查匹配依据、成品版式和求职信，再决定是否使用。", "Review the evidence, final layout, and cover letter before using them.")}
            state="next"
          />
        </section>

        <section className="rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-5 sm:p-6">
          <p className="eyebrow text-[#7A6A50]">Built for trust</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {[
              text("不编造经历", "No invented experience"),
              text("修改依据可追溯", "Every change is traceable"),
              text("投递前始终由你确认", "You always approve before applying"),
            ].map((item) => <div key={item} className="flex items-center gap-3 text-sm text-[#1E1A14]"><span className="flex size-7 shrink-0 items-center justify-center rounded-[16px] bg-[#1E1A14] text-xs text-[#F5EFE0]">✓</span>{item}</div>)}
          </div>
          {unavailable && <p role="alert" className="mt-4 text-sm text-[#7A6A50]">{text("暂时无法检查职业档案状态，你仍可直接打开职业档案继续。", "We could not check profile readiness, but you can still open your career profile and continue.")}</p>}
        </section>
      </WorkspacePage>
    </>
  );
}

function JourneyStep({ number, icon, title, description, state, href }: { number: string; icon: BirchIconName; title: string; description: string; state: "loading" | "done" | "current" | "next"; href?: string }) {
  const content = (
    <>
      <div className="flex items-center justify-between">
        <span className="flex size-10 items-center justify-center rounded-[6px] bg-[#EBE2CC]"><BirchIcon name={icon} size={22} /></span>
        <span className="latin text-xs tracking-[0.16em] text-[#7A6A50]">{state === "done" ? "DONE" : number}</span>
      </div>
      <h3 className="mt-5 text-lg font-medium tracking-[0.04em]">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-[#7A6A50]">{description}</p>
    </>
  );
  const className = `block min-h-48 rounded-[16px] border p-5 ${state === "current" ? "border-[#1E1A14] bg-[#F5EFE0] shadow-[0_10px_30px_rgba(30,26,20,0.08)]" : "border-[rgba(30,26,20,0.12)] bg-[rgba(249,245,234,0.58)]"}`;
  return href ? <Link href={href} className={`${className} lift-card`}>{content}</Link> : <div className={className}>{content}</div>;
}
