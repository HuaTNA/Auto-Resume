"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Header from "@/components/Header";
import { BirchIcon } from "@/components/icons/BirchIcons";
import { createGenerationJob, getGenerationJob, getProfileCompleteness, compilePdf, compileCoverLetterPdf } from "@/lib/api";
import { useLanguage } from "@/lib/language-context";

type Step = "input" | "parsing" | "bullets" | "generating" | "result";

interface ATSResult {
  keyword_match: {
    score: number;
    matched: number;
    total_keywords: number;
    missing: string[];
  };
  semantic: {
    overall_score: number;
    relevance_score: number;
    impact_score: number;
    strength: string;
    suggestions: string[];
    missing_critical: string[];
  };
}

interface GenerateDraft {
  jd: string;
  role?: string;
  company?: string;
}

export default function GeneratePage() {
  return (
    <Suspense>
      <GenerateContent />
    </Suspense>
  );
}

function GenerateContent() {
  const { text } = useLanguage();
  const searchParams = useSearchParams();
  const requestedTemplate = searchParams.get("template");
  const initialTemplate = requestedTemplate && ["classic", "modern", "consulting"].includes(requestedTemplate) ? requestedTemplate : "classic";
  const [step, setStep] = useState<Step>("input");
  const [jdText, setJdText] = useState("");
  const [template, setTemplate] = useState(initialTemplate);
  const [genCoverLetter, setGenCoverLetter] = useState(true);

  // Pipeline data
  const [jdAnalysis, setJdAnalysis] = useState<Record<string, unknown> | null>(null);
  const [totalBullets, setTotalBullets] = useState(0);
  const [resumeTex, setResumeTex] = useState("");
  const [coverLetter, setCoverLetter] = useState("");
  const [atsResult, setAtsResult] = useState<ATSResult | null>(null);
  const [rounds, setRounds] = useState<{ round: number; overall: number }[]>([]);
  const [historyRecordId, setHistoryRecordId] = useState<number | null>(null);
  const [profileBlocking, setProfileBlocking] = useState<string[]>([]);
  const [profileWarnings, setProfileWarnings] = useState<string[]>([]);
  const [draftContext, setDraftContext] = useState<GenerateDraft | null>(null);
  const [error, setError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [previewTab, setPreviewTab] = useState<"resume" | "cover">("resume");

  useEffect(() => {
    getProfileCompleteness().then((result) => {
      setProfileBlocking(result.blocking || []);
      setProfileWarnings(result.warnings || []);
    }).catch(() => undefined);
    const savedDraft = window.sessionStorage.getItem("hua:generate-draft");
    if (savedDraft) {
      try {
        const parsed = JSON.parse(savedDraft) as GenerateDraft;
        if (parsed.jd) {
          setJdText(parsed.jd);
          setDraftContext(parsed);
        }
      } catch {
        window.sessionStorage.removeItem("hua:generate-draft");
      }
    }
  }, []);

  async function handleGenerate() {
    if (!jdText.trim() || profileBlocking.length > 0) return;
    setError("");
    setHistoryRecordId(null);

    try {
      setStep("parsing");
      setStatusMsg(text("正在建立生成任务…", "Preparing generation…"));
      const key = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      let job = (await createGenerationJob(jdText, template, genCoverLetter, key)).job;
      let pollingAttempts = 0;
      while (job.status === "queued" || job.status === "running") {
        pollingAttempts += 1;
        if (pollingAttempts > 240) throw new Error(text("生成等待时间过长，请稍后从申请记录中查看。", "Generation is taking longer than expected. Check Applications again shortly."));
        setStep(job.status === "queued" ? "parsing" : "generating");
        setStatusMsg(job.status === "queued" ? text("正在等待生成服务…", "Waiting for generation service…") : text(`正在生成申请材料… ${job.progress}%`, `Creating application materials… ${job.progress}%`));
        await new Promise((resolve) => setTimeout(resolve, 1000));
        job = (await getGenerationJob(job.id)).job;
      }
      if (job.status !== "completed" || !job.result) throw new Error(job.error || "Generation failed");
      const result = job.result;
      setJdAnalysis(result.jd_analysis);
      setTotalBullets((result.filtered_profile?.experiences || []).reduce((sum: number, item: { bullets?: unknown[] }) => sum + (item.bullets?.length || 0), 0) + (result.filtered_profile?.projects || []).reduce((sum: number, item: { bullets?: unknown[] }) => sum + (item.bullets?.length || 0), 0));
      setResumeTex(result.resume_tex);
      setCoverLetter(result.cover_letter || "");
      setAtsResult(result.ats_result);
      setRounds(result.optimization_rounds || []);
      setHistoryRecordId(result.record_id);
      window.sessionStorage.removeItem("hua:generate-draft");
      setStep("result");
      setStatusMsg("");
      setDraftContext(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
      setStep("input");
    }
  }

  function handleReset() {
    setStep("input");
    setJdText("");
    setJdAnalysis(null);
    setResumeTex("");
    setCoverLetter("");
    setAtsResult(null);
    setRounds([]);
    setHistoryRecordId(null);
    setError("");
    setStatusMsg("");
    setPreviewTab("resume");
  }

  return (
    <>
      <Header
        eyebrow={{ zh: "简历工作室", en: "RESUME STUDIO" }}
        title={{ zh: "生成定制简历", en: "Create a tailored resume" }}
        subtitle={{ zh: "粘贴职位描述，桦会从你的真实经历中选择最相关的证据。", en: "Paste a job description and Hua will select the most relevant evidence from your real experience." }}
      />

      <div className="mx-auto w-full max-w-[960px] p-5 sm:p-7 lg:p-7">
        {/* Progress bar */}
        <div className="mb-5 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <StepIndicator num={1} active={step === "input"} done={step !== "input"} />
            <span className="text-sm font-normal">{text("职位描述", "Job description")}</span>
          </div>
          <div className="flex-1 h-0.5 bg-[#B8A98A]" />
          <div className="flex items-center gap-2">
            <StepIndicator
              num={2}
              active={step === "parsing" || step === "bullets"}
              done={["generating", "result"].includes(step)}
            />
            <span className="text-sm font-normal">{text("生成", "Generate")}</span>
          </div>
          <div className="flex-1 h-0.5 bg-[#B8A98A]" />
          <div className="flex items-center gap-2">
            <StepIndicator
              num={3}
              active={step === "generating"}
              done={step === "result"}
            />
            <span className="text-sm font-normal">{text("审核下载", "Review")}</span>
          </div>
        </div>

        {error && (
          <div role="alert" className="mb-6 rounded-[8px] border border-[rgba(30,26,20,0.16)] bg-[#F5EFE0] p-4 text-sm text-[#1E1A14]">
            {error}
          </div>
        )}
        {step === "input" && profileBlocking.length > 0 && <div className="mb-5 flex flex-col gap-4 rounded-[12px] border border-[rgba(30,26,20,0.16)] bg-[#F5EFE0] p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{text("职业档案还不能用于生成", "Your career profile is not ready yet")}</p><p className="mt-1 text-sm text-[#7A6A50]">{text(`还需完成 ${profileBlocking.length} 项必要信息：至少一段经历或项目、成果证据及基本联系方式。`, `${profileBlocking.length} required profile item(s) still need attention, including experience evidence and contact details.`)}</p></div><Link href="/profile" className="secondary-button shrink-0">{text("现在完善", "Complete profile")}<span aria-hidden="true">→</span></Link></div>}

        {/* Step 1: Input */}
        {step === "input" && (
          <div>
            <div className="overflow-hidden rounded-[16px] border border-[rgba(30,26,20,0.14)] bg-[#F5EFE0] shadow-[0_10px_32px_rgba(30,26,20,0.07)]">
              <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[0.7fr_1.3fr] lg:gap-8">
                <div>
                  <span className="flex size-11 items-center justify-center rounded-[6px] bg-[#1E1A14] text-[#F5EFE0]"><BirchIcon name="bark" size={24} className="brightness-[4]" /></span>
                  <p className="eyebrow mt-5 text-[#7A6A50]">Step 01</p>
                  <h2 className="mt-2 text-2xl font-medium tracking-[0.04em]">{text("粘贴完整职位描述", "Paste the full job description")}</h2>
                  <p className="mt-3 text-sm leading-7 text-[#7A6A50]">{text("职责、技能要求和加分项越完整，匹配越准确。桦只会使用职业档案中已有的真实证据。", "Include responsibilities, requirements, and preferred skills for a better match. Hua only uses evidence already in your career profile.")}</p>
                  {draftContext?.role && <div className="mt-5 rounded-[8px] bg-[#EBE2CC] px-3 py-3 text-sm"><p className="font-medium">{draftContext.role}</p>{draftContext.company && <p className="mt-1 text-[#7A6A50]">{draftContext.company}</p>}</div>}
                  <p className="mt-5 text-sm leading-6 text-[#1E1A14]">✓ {text("仅使用真实经历 · 生成后可审核 · 自动保存到申请记录", "Real experience only · Review before using · Saved to Applications")}</p>
                </div>
                <textarea
                  value={jdText}
                  onChange={(e) => setJdText(e.target.value)}
                  className="min-h-[240px] w-full resize-y rounded-[10px] border border-[rgba(30,26,20,0.16)] bg-[#FDFAF3] p-5 text-[15px] leading-7 text-[#1E1A14] focus:border-[#1E1A14] focus:ring-0"
                  placeholder={text("在此贴入完整职位描述…", "Paste the full job description here…")}
                />
              </div>
              <div className="flex flex-col gap-4 border-t border-[rgba(30,26,20,0.10)] bg-[#EDE7D3] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <div className="flex flex-wrap items-center gap-5">
                <label className="flex items-center gap-3 text-sm font-medium text-[#1E1A14]">{text("简历模板", "Resume template")}
                <select
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  className="rounded-[6px] border border-[rgba(30,26,20,0.14)] bg-[#F5EFE0] px-3 py-2 text-sm"
                >
                  <option value="classic">Classic</option>
                  <option value="modern">Modern</option>
                  <option value="consulting">Consulting</option>
                </select>
                </label>
              <label className="flex min-h-10 items-center gap-2 text-sm text-[#1E1A14]">
                <input
                  type="checkbox"
                  checked={genCoverLetter}
                  onChange={(e) => setGenCoverLetter(e.target.checked)}
                  className="rounded text-[#1E1A14]"
                />
                {text("生成求职信", "Generate cover letter")}
              </label>
              </div>
              <button
                onClick={handleGenerate}
                disabled={!jdText.trim() || profileBlocking.length > 0}
                className="primary-button min-h-11 px-8 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <BirchIcon name="leaf" size={18} />
                {profileBlocking.length > 0 ? text("先完善档案", "Complete profile first") : text("生成定制简历", "Generate tailored resume")}
              </button>
              </div>
            </div>
            {profileWarnings.length > 0 && profileBlocking.length === 0 && <p className="mt-3 text-sm text-[#7A6A50]">{text(`档案可以生成；另有 ${profileWarnings.length} 项可选信息可稍后补充。`, `Your profile is ready. ${profileWarnings.length} optional item(s) can be completed later.`)}</p>}
          </div>
        )}

        {/* Processing steps */}
        {(step === "parsing" || step === "bullets" || step === "generating") && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="mb-6 flex size-12 animate-pulse items-center justify-center rounded-[6px] bg-[#EBE2CC]"><BirchIcon name="growth-ring" size={28} /></div>
            <p className="text-lg font-medium text-[#7A6A50]">{statusMsg}</p>
            {jdAnalysis && (
              <p className="text-sm text-[#9A8468] mt-2">
                {(jdAnalysis as Record<string, string>).job_title} @ {(jdAnalysis as Record<string, string>).company}
              </p>
            )}
            {totalBullets > 0 && (
              <p className="text-sm text-[#9A8468] mt-1">
                {text(`已选择 ${totalBullets} 条相关经历证据`, `${totalBullets} relevant evidence bullets selected`)}
              </p>
            )}
          </div>
        )}

        {/* Result */}
        {step === "result" && atsResult && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left panel - ATS + actions */}
            <div className="lg:col-span-4 space-y-6">
              {/* ATS Scores */}
              <div className="soft-card p-6">
                <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
                  <BirchIcon name="growth-ring" size={20} />
                  {text("匹配概览", "Match overview")}
                </h3>
                <div className="space-y-4">
                  <ScoreBar label={text("整体匹配", "Overall match")} value={atsResult.semantic.overall_score} />
                  <div className="grid grid-cols-2 gap-4">
                    <ScoreBox label={text("关键词", "Keywords")} value={`${atsResult.keyword_match.score}%`} />
                    <ScoreBox label={text("相关性", "Relevance")} value={`${atsResult.semantic.relevance_score}%`} />
                    <ScoreBox label={text("影响力", "Impact")} value={`${atsResult.semantic.impact_score}%`} />
                    <ScoreBox label={text("优化轮次", "Rounds")} value={rounds.length.toString()} />
                  </div>
                </div>
              </div>

              {/* JD Info */}
              {jdAnalysis && (
                <div className="soft-card p-6">
                  <h3 className="text-lg font-medium mb-3">{text("职位解析", "Job analysis")}</h3>
                  <p className="text-sm font-medium">{(jdAnalysis as Record<string, string>).job_title}</p>
                  <p className="text-sm text-[#9A8468]">{(jdAnalysis as Record<string, string>).company} - {(jdAnalysis as Record<string, string>).seniority}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {((jdAnalysis as Record<string, string[]>).required_skills || []).slice(0, 8).map((s: string) => (
                      <span key={s} className="text-xs bg-[#1E1A14]/10 text-[#1E1A14] px-2 py-0.5 rounded-[6px]">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggestions */}
              {atsResult.semantic.suggestions.length > 0 && (
                <div className="soft-card p-6">
                  <h3 className="text-sm font-medium mb-3">{text("改进建议", "Suggestions")}</h3>
                  <div className="space-y-2">
                    {atsResult.semantic.suggestions.map((s, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm text-[#7A6A50]">
                        <BirchIcon name="bud" size={15} className="mt-0.5" />
                        {s}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <DownloadActions
                resumeTex={resumeTex}
                coverLetter={coverLetter}
                recordId={historyRecordId}
                onReset={handleReset}
              />
            </div>

            {/* Right panel - document preview */}
            <div className="lg:col-span-8">
              <div className="soft-card relative overflow-hidden">
                <div className="absolute top-4 right-4 bg-[#EBE2CC] px-3 py-1 rounded text-[10px] text-[#9A8468]  tracking-widest uppercase">
                  {previewTab === "resume" ? text("成品预览", "Document preview") : text("求职信预览", "Cover letter preview")}
                </div>

                {/* Tab bar */}
                <div className="flex border-b border-[rgba(30,26,20,0.12)] px-4 pt-4">
                  <TabButton label={text("履历", "Resume")} active={previewTab === "resume"} onClick={() => setPreviewTab("resume")} />
                  {coverLetter && <TabButton label={text("求职信", "Cover letter")} active={previewTab === "cover"} onClick={() => setPreviewTab("cover")} />}
                </div>

                {previewTab === "resume" ? (
                  <ResumePreview recordId={historyRecordId} resumeTex={resumeTex} />
                ) : (
                  <div className="p-8 overflow-auto max-h-[800px] text-sm leading-relaxed text-[#7A6A50] whitespace-pre-wrap">
                    {coverLetter}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function StepIndicator({ num, active, done }: { num: number; active: boolean; done: boolean }) {
  const base = "flex items-center justify-center size-8 rounded-[6px] text-sm font-medium";
  if (done) return <div className={`${base} bg-[#1E1A14] text-[#F5EFE0]`}>
    <span aria-hidden="true">已</span>
  </div>;
  if (active) return <div className={`${base} bg-[#1E1A14] text-[#F5EFE0]`}>{num}</div>;
  return <div className={`${base} bg-[#B8A98A] text-[#9A8468]`}>{num}</div>;
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = value >= 80 ? "bg-[#1E1A14]" : value >= 60 ? "bg-[#7A6A50]" : "bg-[#B8A98A]";
  const textColor = value >= 80 ? "text-[#1E1A14]" : value >= 60 ? "text-[#7A6A50]" : "text-[#1E1A14]";
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-sm font-medium">{label}</span>
        <span className={`text-sm font-medium ${textColor}`}>{value}%</span>
      </div>
      <div className="w-full h-2 bg-[#EBE2CC] rounded-[6px]">
        <div className={`h-full rounded-[6px] ${color}`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
    </div>
  );
}

function ScoreBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 bg-[#FDFAF3] rounded-lg border border-[rgba(30,26,20,0.12)]">
      <p className="text-xs text-[#9A8468] uppercase font-medium">{label}</p>
      <p className="text-xl font-medium text-[#1E1A14]">{value}</p>
    </div>
  );
}

function TabButton({ label, active = false, onClick }: { label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b -mb-px transition-colors ${
        active ? "border-[#B8A98A] text-[#1E1A14]" : "border-transparent text-[#9A8468] hover:text-[#7A6A50]"
      }`}
    >
      {label}
    </button>
  );
}

function ResumePreview({ recordId, resumeTex }: { recordId: number | null; resumeTex: string }) {
  const { text } = useLanguage();
  const [pdfUrl, setPdfUrl] = useState("");
  const [loading, setLoading] = useState(Boolean(recordId));
  const [previewError, setPreviewError] = useState("");

  useEffect(() => {
    if (!recordId) return;
    let active = true;
    let objectUrl = "";
    compilePdf(recordId)
      .then((result) => {
        if (!active) return;
        if (!result.ok || !result.pdf_base64) throw new Error(result.error || "PDF preview unavailable");
        const bytes = Uint8Array.from(atob(result.pdf_base64), (character) => character.charCodeAt(0));
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        setPdfUrl(objectUrl);
      })
      .catch(() => {
        if (active) setPreviewError(text("暂时无法生成 PDF 预览，你仍可下载源文件或稍后重试。", "PDF preview is temporarily unavailable. You can still download the source or retry later."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [recordId, text]);

  if (loading) return <div className="flex min-h-[680px] flex-col items-center justify-center bg-[#E8E1D0] p-8"><div className="h-[540px] w-full max-w-[390px] animate-pulse rounded-[4px] bg-[#FDFAF3] shadow-[0_14px_40px_rgba(30,26,20,0.14)]" /><p className="mt-5 text-sm text-[#7A6A50]">{text("正在生成成品预览…", "Preparing document preview…")}</p></div>;
  if (pdfUrl) return <div className="bg-[#E8E1D0] p-4 sm:p-6"><iframe title={text("定制简历 PDF 预览", "Tailored resume PDF preview")} src={`${pdfUrl}#toolbar=0&navpanes=0`} className="h-[760px] w-full rounded-[4px] bg-[#FDFAF3] shadow-[0_14px_40px_rgba(30,26,20,0.16)]" /></div>;

  return <div className="p-6 sm:p-8"><div className="rounded-[10px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-5"><p className="text-sm leading-6 text-[#7A6A50]">{previewError || text("预览尚未生成。", "Preview is not available yet.")}</p></div><details className="mt-5 rounded-[8px] border border-[rgba(30,26,20,0.10)]"><summary className="cursor-pointer px-4 py-3 text-sm text-[#1E1A14]">{text("高级选项：查看 LaTeX 源码", "Advanced: view LaTeX source")}</summary><pre className="max-h-[520px] overflow-auto border-t border-[rgba(30,26,20,0.10)] p-5 font-mono text-xs leading-relaxed text-[#7A6A50] whitespace-pre-wrap">{resumeTex}</pre></details></div>;
}

function DownloadActions({
  resumeTex,
  coverLetter,
  recordId,
  onReset,
}: {
  resumeTex: string;
  coverLetter: string;
  recordId: number | null;
  onReset: () => void;
}) {
  const [pdfLoading, setPdfLoading] = useState<"resume" | "cover" | null>(null);
  const [pdfError, setPdfError] = useState("");
  const { text } = useLanguage();

  function downloadFile(content: string, filename: string) {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handlePdf(type: "resume" | "cover", filename: string) {
    if (!recordId) {
      setPdfError("Save the result before compiling a PDF.");
      return;
    }
    setPdfLoading(type);
    setPdfError("");
    try {
      const result =
        type === "resume"
          ? await compilePdf(recordId)
          : await compileCoverLetterPdf(recordId);
      if (result.ok) {
        const bytes = Uint8Array.from(atob(result.pdf_base64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        setPdfError(result.error || "PDF compilation failed");
      }
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : "PDF compilation failed");
    } finally {
      setPdfLoading(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {pdfError && (
        <div className="p-3 bg-[#EBE2CC] border border-[rgba(30,26,20,0.12)] rounded-lg text-[#1E1A14] text-xs">
          {pdfError}
        </div>
      )}

      {/* Resume downloads */}
      <button
        onClick={() => handlePdf("resume", "resume.pdf")}
        disabled={pdfLoading !== null || !recordId}
        className="w-full bg-[#1E1A14] text-[#F5EFE0] font-medium py-3 rounded-lg shadow-[0_2px_10px_rgba(30,26,20,0.07)] hover:bg-[#1E1A14]/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <span className="latin text-[10px] uppercase tracking-[0.2em]">PDF</span>
        {pdfLoading === "resume" ? text("正在生成 PDF…", "Compiling PDF…") : text("下载履历 PDF", "Download resume PDF")}
      </button>
      <button
        onClick={() => downloadFile(resumeTex, "resume.tex")}
        className="w-full bg-[#F5EFE0] border border-[rgba(30,26,20,0.12)] text-[#7A6A50] font-medium py-2.5 rounded-lg hover:bg-[#FDFAF3] transition-all flex items-center justify-center gap-2 text-sm"
      >
        <span className="latin text-[10px] uppercase tracking-[0.2em]">TEX</span>
        {text("下载 LaTeX 源文件", "Download LaTeX source")}
      </button>
      {recordId && <Link href="/documents" className="secondary-button w-full justify-center">{text("编辑并保存新版本", "Edit and save a new version")}</Link>}

      {/* Cover letter downloads */}
      {coverLetter && (
        <>
          <button
            onClick={() => handlePdf("cover", "cover_letter.pdf")}
            disabled={pdfLoading !== null || !recordId}
            className="w-full bg-[#1E1A14] text-[#F5EFE0] font-medium py-3 rounded-lg hover:bg-[#1E1A14] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <span className="latin text-[10px] uppercase tracking-[0.2em]">PDF</span>
            {pdfLoading === "cover" ? text("正在生成 PDF…", "Compiling PDF…") : text("下载求职信 PDF", "Download cover letter PDF")}
          </button>
          <button
            onClick={() => downloadFile(coverLetter, "cover_letter.txt")}
            className="w-full bg-[#F5EFE0] border border-[rgba(30,26,20,0.12)] text-[#7A6A50] font-medium py-2.5 rounded-lg hover:bg-[#FDFAF3] transition-all flex items-center justify-center gap-2 text-sm"
          >
            <span className="latin text-[10px] uppercase tracking-[0.2em]">TXT</span>
            {text("下载求职信文本", "Download cover letter text")}
          </button>
        </>
      )}

      <button
        onClick={onReset}
        className="w-full bg-[#EBE2CC] text-[#7A6A50] font-medium py-3 rounded-lg hover:bg-[#B8A98A] transition-all"
      >
        {text("再成一篇", "Create another")}
      </button>
    </div>
  );
}
