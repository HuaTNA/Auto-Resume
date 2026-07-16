"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Header from "@/components/Header";
import { BirchIcon } from "@/components/icons/BirchIcons";
import { parseJD, retrieveBullets, generateResume, scoreResume, refineResume, saveHistory, compilePdf, compileCoverLetterPdf } from "@/lib/api";
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
  const [step, setStep] = useState<Step>("input");
  const [jdText, setJdText] = useState("");
  const [template, setTemplate] = useState("classic");
  const [genCoverLetter, setGenCoverLetter] = useState(true);

  useEffect(() => {
    const t = searchParams.get("template");
    if (t && ["classic", "modern", "consulting"].includes(t)) {
      setTemplate(t);
    }
  }, [searchParams]);

  // Pipeline data
  const [jdAnalysis, setJdAnalysis] = useState<Record<string, any> | null>(null);
  const [filteredProfile, setFilteredProfile] = useState<Record<string, any> | null>(null);
  const [totalBullets, setTotalBullets] = useState(0);
  const [resumeTex, setResumeTex] = useState("");
  const [coverLetter, setCoverLetter] = useState("");
  const [atsResult, setAtsResult] = useState<ATSResult | null>(null);
  const [rounds, setRounds] = useState<{ round: number; overall: number }[]>([]);
  const [error, setError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [previewTab, setPreviewTab] = useState<"resume" | "cover">("resume");

  async function handleGenerate() {
    if (!jdText.trim()) return;
    setError("");

    try {
      // Step 1: Parse JD
      setStep("parsing");
      setStatusMsg("Parsing job description...");
      const parseResult = await parseJD(jdText);
      setJdAnalysis(parseResult.jd_analysis);

      if (parseResult.is_duplicate) {
        setStatusMsg("Warning: You already generated a resume for this role. Continuing...");
      }

      // Step 2: Retrieve bullets
      setStep("bullets");
      setStatusMsg("Selecting relevant experience bullets...");
      const bulletResult = await retrieveBullets(parseResult.jd_analysis, 12);
      setFilteredProfile(bulletResult.filtered_profile);
      setTotalBullets(bulletResult.total_selected);

      // Step 3: Generate resume
      setStep("generating");
      setStatusMsg("Generating tailored resume...");
      const genResult = await generateResume(
        bulletResult.filtered_profile,
        parseResult.jd_analysis,
        template,
        genCoverLetter
      );
      let currentTex = genResult.resume_tex;
      setResumeTex(currentTex);
      if (genResult.cover_letter) {
        setCoverLetter(genResult.cover_letter);
      }

      // Step 4: ATS scoring + refinement
      const thresholds = { overall: 80, keyword_pct: 60, relevance: 80, impact: 80 };
      const maxRounds = 3;
      const roundHistory: { round: number; overall: number }[] = [];
      let lastAts: Record<string, any> | null = null;

      for (let r = 1; r <= maxRounds; r++) {
        setStatusMsg(`ATS analysis (round ${r}/${maxRounds})...`);
        const scoreResult = await scoreResume(currentTex, parseResult.jd_analysis);
        const ats = scoreResult.ats_result;
        lastAts = ats;
        setAtsResult(ats);

        roundHistory.push({ round: r, overall: ats.semantic.overall_score });
        setRounds([...roundHistory]);

        const passed =
          ats.semantic.overall_score >= thresholds.overall &&
          ats.keyword_match.score >= thresholds.keyword_pct &&
          ats.semantic.relevance_score >= thresholds.relevance &&
          ats.semantic.impact_score >= thresholds.impact;

        if (passed || r === maxRounds) break;

        setStatusMsg(`Refining resume (round ${r + 1})...`);
        const refineResult = await refineResume(
          currentTex,
          ats,
          parseResult.jd_analysis,
          bulletResult.filtered_profile
        );
        currentTex = refineResult.resume_tex;
        setResumeTex(currentTex);
      }

      // Save to history
      try {
        if (lastAts) {
          await saveHistory(parseResult.jd_analysis, lastAts, template, currentTex, genResult.cover_letter || "");
        }
      } catch {
        // History save failure is non-critical
      }

      setStep("result");
      setStatusMsg("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
      setStep("input");
    }
  }

  function handleReset() {
    setStep("input");
    setJdText("");
    setJdAnalysis(null);
    setFilteredProfile(null);
    setResumeTex("");
    setCoverLetter("");
    setAtsResult(null);
    setRounds([]);
    setError("");
    setStatusMsg("");
    setPreviewTab("resume");
  }

  return (
    <>
      <Header
        eyebrow={{ zh: "申请文书 · 成文", en: "APPLICATION STUDIO · CREATE" }}
        title={{ zh: "因职成文", en: "Tailor an application" }}
        subtitle={{ zh: "读懂职位所需，再从真实经历中取材成篇。", en: "Read what the role needs, then shape an answer from real experience." }}
      />

      <div className="mx-auto w-full max-w-[960px] p-5 sm:p-8 lg:p-10">
        {/* Progress bar */}
        <div className="flex items-center gap-4 mb-8">
          <div className="flex items-center gap-2">
            <StepIndicator num={1} active={step === "input"} done={step !== "input"} />
            <span className="text-sm font-normal">{text("职位", "Role")}</span>
          </div>
          <div className="flex-1 h-0.5 bg-[#B8A98A]" />
          <div className="flex items-center gap-2">
            <StepIndicator
              num={2}
              active={step === "parsing" || step === "bullets"}
              done={["generating", "result"].includes(step)}
            />
            <span className="text-sm font-normal">{text("辨析", "Analyze")}</span>
          </div>
          <div className="flex-1 h-0.5 bg-[#B8A98A]" />
          <div className="flex items-center gap-2">
            <StepIndicator
              num={3}
              active={step === "generating"}
              done={step === "result"}
            />
            <span className="text-sm font-normal">{text("成文", "Create")}</span>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-[#EBE2CC] border border-[rgba(30,26,20,0.12)] rounded-lg text-[#1E1A14] text-sm">
            {error}
          </div>
        )}

        {/* Step 1: Input */}
        {step === "input" && (
          <div className="space-y-6">
            <div className="rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#EBE2CC] p-6 sm:p-8">
              <div className="max-w-3xl mx-auto text-center">
                <BirchIcon name="bark" size={40} className="mx-auto mb-4" />
                <h2 className="mb-3 text-2xl font-light tracking-[0.1em]">{text("贴入职位描述", "Add the job description")}</h2>
                <p className="text-[#7A6A50] mb-6">
                  {text("桦将辨析职责与能力要求，并从你的经历中选择相称的证据。", "桦 will read the responsibilities and select fitting evidence from your experience.")}
                </p>
                <textarea
                  value={jdText}
                  onChange={(e) => setJdText(e.target.value)}
                  className="w-full min-h-[250px] p-6 rounded-xl border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] focus:border-[#1E1A14] focus:ring-0 text-[#1E1A14] resize-none text-sm"
                  placeholder={text("在此贴入完整职位描述…", "Paste the full job description here…")}
                />
              </div>
            </div>

            {/* Options */}
            <div className="soft-card flex flex-wrap items-center justify-between gap-6 rounded-[16px] p-5 sm:p-6">
              <div className="flex items-center gap-4">
                <label className="text-sm font-medium text-[#7A6A50]">{text("范式：", "Template:")}</label>
                <select
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  className="text-sm border border-[rgba(30,26,20,0.12)] rounded-lg px-3 py-2"
                >
                  <option value="classic">Classic</option>
                  <option value="modern">Modern</option>
                  <option value="consulting">Consulting</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={genCoverLetter}
                  onChange={(e) => setGenCoverLetter(e.target.checked)}
                  className="rounded text-[#1E1A14]"
                />
                {text("生成求职信", "Generate cover letter")}
              </label>
              <button
                onClick={handleGenerate}
                disabled={!jdText.trim()}
                className="primary-button px-8 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <BirchIcon name="leaf" size={18} />
                {text("生成履历", "Generate resume")}
              </button>
            </div>
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
                Selected {totalBullets} relevant bullets
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
                  ATS Optimization Score
                </h3>
                <div className="space-y-4">
                  <ScoreBar label="Overall Match" value={atsResult.semantic.overall_score} />
                  <div className="grid grid-cols-2 gap-4">
                    <ScoreBox label="Keywords" value={`${atsResult.keyword_match.score}%`} />
                    <ScoreBox label="Relevance" value={`${atsResult.semantic.relevance_score}%`} />
                    <ScoreBox label="Impact" value={`${atsResult.semantic.impact_score}%`} />
                    <ScoreBox label="Rounds" value={rounds.length.toString()} />
                  </div>
                </div>
              </div>

              {/* JD Info */}
              {jdAnalysis && (
                <div className="soft-card p-6">
                  <h3 className="text-lg font-medium mb-3">Job Analysis</h3>
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
                  <h3 className="text-sm font-medium mb-3">Suggestions</h3>
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
                onReset={handleReset}
              />
            </div>

            {/* Right panel - LaTeX preview */}
            <div className="lg:col-span-8">
              <div className="soft-card relative overflow-hidden">
                <div className="absolute top-4 right-4 bg-[#EBE2CC] px-3 py-1 rounded text-[10px] text-[#9A8468]  tracking-widest uppercase">
                  {previewTab === "resume" ? "LaTeX Preview" : "Cover Letter Preview"}
                </div>

                {/* Tab bar */}
                <div className="flex border-b border-[rgba(30,26,20,0.12)] px-4 pt-4">
                  <TabButton label={text("履历", "Resume")} active={previewTab === "resume"} onClick={() => setPreviewTab("resume")} />
                  {coverLetter && <TabButton label={text("求职信", "Cover letter")} active={previewTab === "cover"} onClick={() => setPreviewTab("cover")} />}
                </div>

                {previewTab === "resume" ? (
                  <pre className="p-8 overflow-auto max-h-[800px] text-xs leading-relaxed font-mono text-[#7A6A50] whitespace-pre-wrap">
                    {resumeTex}
                  </pre>
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

function DownloadActions({
  resumeTex,
  coverLetter,
  onReset,
}: {
  resumeTex: string;
  coverLetter: string;
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
    setPdfLoading(type);
    setPdfError("");
    try {
      const result =
        type === "resume"
          ? await compilePdf(resumeTex)
          : await compileCoverLetterPdf(coverLetter);
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
        disabled={pdfLoading !== null}
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

      {/* Cover letter downloads */}
      {coverLetter && (
        <>
          <button
            onClick={() => handlePdf("cover", "cover_letter.pdf")}
            disabled={pdfLoading !== null}
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
