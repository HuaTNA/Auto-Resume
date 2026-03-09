"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Header from "@/components/Header";
import { parseJD, retrieveBullets, generateResume, scoreResume, refineResume, saveHistory, compilePdf, compileCoverLetterPdf } from "@/lib/api";

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
      <Header title="Generate Resume" />

      <div className="p-8 max-w-7xl mx-auto w-full">
        {/* Progress bar */}
        <div className="flex items-center gap-4 mb-8">
          <div className="flex items-center gap-2">
            <StepIndicator num={1} active={step === "input"} done={step !== "input"} />
            <span className="text-sm font-medium">Input JD</span>
          </div>
          <div className="flex-1 h-0.5 bg-slate-200" />
          <div className="flex items-center gap-2">
            <StepIndicator
              num={2}
              active={step === "parsing" || step === "bullets"}
              done={["generating", "result"].includes(step)}
            />
            <span className="text-sm font-medium">Analyze</span>
          </div>
          <div className="flex-1 h-0.5 bg-slate-200" />
          <div className="flex items-center gap-2">
            <StepIndicator
              num={3}
              active={step === "generating"}
              done={step === "result"}
            />
            <span className="text-sm font-medium">Generate & Optimize</span>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Step 1: Input */}
        {step === "input" && (
          <div className="space-y-6">
            <div className="p-8 bg-[#4051b5]/5 rounded-2xl border-2 border-dashed border-[#4051b5]/20">
              <div className="max-w-3xl mx-auto text-center">
                <span className="material-symbols-outlined text-4xl text-[#4051b5] mb-4 block">
                  terminal
                </span>
                <h2 className="text-2xl font-black mb-4">Paste Job Description</h2>
                <p className="text-slate-600 mb-6">
                  Paste the target job description to let our AI tailor your resume for maximum ATS score.
                </p>
                <textarea
                  value={jdText}
                  onChange={(e) => setJdText(e.target.value)}
                  className="w-full min-h-[250px] p-6 rounded-xl border-2 border-[#4051b5]/20 bg-white focus:border-[#4051b5] focus:ring-0 text-slate-800 resize-none text-sm"
                  placeholder="Paste the full job description here..."
                />
              </div>
            </div>

            {/* Options */}
            <div className="flex flex-wrap gap-6 items-center justify-between bg-white p-6 rounded-xl border border-slate-200">
              <div className="flex items-center gap-4">
                <label className="text-sm font-medium text-slate-700">Template:</label>
                <select
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  className="text-sm border border-slate-300 rounded-lg px-3 py-2"
                >
                  <option value="classic">Classic</option>
                  <option value="modern">Modern (Blue)</option>
                  <option value="consulting">Consulting</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={genCoverLetter}
                  onChange={(e) => setGenCoverLetter(e.target.checked)}
                  className="rounded text-[#4051b5]"
                />
                Generate Cover Letter
              </label>
              <button
                onClick={handleGenerate}
                disabled={!jdText.trim()}
                className="bg-[#4051b5] text-white px-8 py-3 rounded-lg font-bold flex items-center gap-2 hover:bg-[#4051b5]/90 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-[#4051b5]/20 transition-all"
              >
                <span className="material-symbols-outlined">auto_fix_high</span>
                Generate Resume
              </button>
            </div>
          </div>
        )}

        {/* Processing steps */}
        {(step === "parsing" || step === "bullets" || step === "generating") && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="animate-spin size-12 border-4 border-[#4051b5]/20 border-t-[#4051b5] rounded-full mb-6" />
            <p className="text-lg font-medium text-slate-700">{statusMsg}</p>
            {jdAnalysis && (
              <p className="text-sm text-slate-500 mt-2">
                {(jdAnalysis as Record<string, string>).job_title} @ {(jdAnalysis as Record<string, string>).company}
              </p>
            )}
            {totalBullets > 0 && (
              <p className="text-sm text-slate-500 mt-1">
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
              <div className="bg-white p-6 rounded-xl border border-[#4051b5]/10 shadow-sm">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#4051b5]">analytics</span>
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
                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                  <h3 className="text-lg font-bold mb-3">Job Analysis</h3>
                  <p className="text-sm font-medium">{(jdAnalysis as Record<string, string>).job_title}</p>
                  <p className="text-sm text-slate-500">{(jdAnalysis as Record<string, string>).company} - {(jdAnalysis as Record<string, string>).seniority}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {((jdAnalysis as Record<string, string[]>).required_skills || []).slice(0, 8).map((s: string) => (
                      <span key={s} className="text-xs bg-[#4051b5]/10 text-[#4051b5] px-2 py-0.5 rounded-full">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggestions */}
              {atsResult.semantic.suggestions.length > 0 && (
                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                  <h3 className="text-sm font-bold mb-3">Suggestions</h3>
                  <div className="space-y-2">
                    {atsResult.semantic.suggestions.map((s, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm text-slate-600">
                        <span className="material-symbols-outlined text-amber-500 text-sm mt-0.5">
                          lightbulb
                        </span>
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
              <div className="bg-white rounded-xl shadow-2xl border border-[#4051b5]/10 relative">
                <div className="absolute top-4 right-4 bg-slate-100 px-3 py-1 rounded text-[10px] text-slate-500 font-sans tracking-widest uppercase">
                  {previewTab === "resume" ? "LaTeX Preview" : "Cover Letter Preview"}
                </div>

                {/* Tab bar */}
                <div className="flex border-b border-slate-200 px-4 pt-4">
                  <TabButton label="Resume" active={previewTab === "resume"} onClick={() => setPreviewTab("resume")} />
                  {coverLetter && <TabButton label="Cover Letter" active={previewTab === "cover"} onClick={() => setPreviewTab("cover")} />}
                </div>

                {previewTab === "resume" ? (
                  <pre className="p-8 overflow-auto max-h-[800px] text-xs leading-relaxed font-mono text-slate-700 whitespace-pre-wrap">
                    {resumeTex}
                  </pre>
                ) : (
                  <div className="p-8 overflow-auto max-h-[800px] text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
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
  const base = "flex items-center justify-center size-8 rounded-full text-sm font-bold";
  if (done) return <div className={`${base} bg-green-500 text-white`}>
    <span className="material-symbols-outlined text-[18px]">check</span>
  </div>;
  if (active) return <div className={`${base} bg-[#4051b5] text-white`}>{num}</div>;
  return <div className={`${base} bg-slate-200 text-slate-500`}>{num}</div>;
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = value >= 80 ? "bg-green-500" : value >= 60 ? "bg-amber-500" : "bg-red-500";
  const textColor = value >= 80 ? "text-green-600" : value >= 60 ? "text-amber-600" : "text-red-600";
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-sm font-medium">{label}</span>
        <span className={`text-sm font-bold ${textColor}`}>{value}%</span>
      </div>
      <div className="w-full h-2 bg-slate-100 rounded-full">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
    </div>
  );
}

function ScoreBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 bg-slate-50 rounded-lg border border-[#4051b5]/5">
      <p className="text-xs text-slate-500 uppercase font-bold">{label}</p>
      <p className="text-xl font-black text-[#4051b5]">{value}</p>
    </div>
  );
}

function TabButton({ label, active = false, onClick }: { label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active ? "border-[#4051b5] text-[#4051b5]" : "border-transparent text-slate-500 hover:text-slate-700"
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
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-xs">
          {pdfError}
        </div>
      )}

      {/* Resume downloads */}
      <button
        onClick={() => handlePdf("resume", "resume.pdf")}
        disabled={pdfLoading !== null}
        className="w-full bg-[#4051b5] text-white font-bold py-3 rounded-lg shadow-lg shadow-[#4051b5]/20 hover:bg-[#4051b5]/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <span className="material-symbols-outlined">picture_as_pdf</span>
        {pdfLoading === "resume" ? "Compiling PDF..." : "Download Resume PDF"}
      </button>
      <button
        onClick={() => downloadFile(resumeTex, "resume.tex")}
        className="w-full bg-white border border-slate-300 text-slate-700 font-medium py-2.5 rounded-lg hover:bg-slate-50 transition-all flex items-center justify-center gap-2 text-sm"
      >
        <span className="material-symbols-outlined text-[18px]">download</span>
        Download LaTeX Source
      </button>

      {/* Cover letter downloads */}
      {coverLetter && (
        <>
          <button
            onClick={() => handlePdf("cover", "cover_letter.pdf")}
            disabled={pdfLoading !== null}
            className="w-full bg-green-600 text-white font-bold py-3 rounded-lg hover:bg-green-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <span className="material-symbols-outlined">picture_as_pdf</span>
            {pdfLoading === "cover" ? "Compiling PDF..." : "Download Cover Letter PDF"}
          </button>
          <button
            onClick={() => downloadFile(coverLetter, "cover_letter.txt")}
            className="w-full bg-white border border-slate-300 text-slate-700 font-medium py-2.5 rounded-lg hover:bg-slate-50 transition-all flex items-center justify-center gap-2 text-sm"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            Download Cover Letter TXT
          </button>
        </>
      )}

      <button
        onClick={onReset}
        className="w-full bg-slate-100 text-slate-700 font-bold py-3 rounded-lg hover:bg-slate-200 transition-all"
      >
        Generate Another
      </button>
    </div>
  );
}
