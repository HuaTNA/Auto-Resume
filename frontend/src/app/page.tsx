"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import { getHistory, updateHistoryStatus, getHistoryRecord, compilePdf, compileCoverLetterPdf } from "@/lib/api";

interface HistoryRecord {
  id: number;
  timestamp: string;
  job_title: string;
  company: string;
  seniority: string;
  template: string;
  ats_scores: {
    overall: number | null;
    keyword_pct: number | null;
    relevance: number | null;
    impact: number | null;
  };
  status: string;
  has_resume: boolean;
  has_cover_letter: boolean;
}

interface RecordDetail {
  resume_tex: string;
  cover_letter: string;
}

interface Stats {
  total: number;
  avg_score: number;
  best_score: number;
  by_status: Record<string, number>;
}

const STATUS_COLORS: Record<string, string> = {
  generated: "bg-blue-100 text-blue-800",
  applied: "bg-green-100 text-green-800",
  interview: "bg-purple-100 text-purple-800",
  offer: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
};

const STATUS_OPTIONS = ["generated", "applied", "interview", "offer", "rejected"];

export default function Dashboard() {
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<RecordDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<"resume" | "cover">("resume");
  const [pdfLoading, setPdfLoading] = useState<"resume" | "cover" | null>(null);
  const [pdfError, setPdfError] = useState("");

  useEffect(() => {
    loadHistory();
  }, []);

  async function loadHistory() {
    try {
      const data = await getHistory();
      setRecords(data.records);
      setStats(data.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }

  async function handleStatusChange(recordId: number, newStatus: string) {
    try {
      await updateHistoryStatus(recordId, newStatus);
      setRecords((prev) =>
        prev.map((r) => (r.id === recordId ? { ...r, status: newStatus } : r))
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to update status");
    }
  }

  async function handleExpand(recordId: number) {
    if (expandedId === recordId) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(recordId);
    setDetail(null);
    setDetailTab("resume");
    setDetailLoading(true);
    setPdfError("");
    try {
      const data = await getHistoryRecord(recordId);
      setDetail({
        resume_tex: data.record.resume_tex || "",
        cover_letter: data.record.cover_letter || "",
      });
    } catch {
      setDetail({ resume_tex: "", cover_letter: "" });
    } finally {
      setDetailLoading(false);
    }
  }

  function downloadFile(content: string, filename: string, type = "text/plain") {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDownloadPdf(type: "resume" | "cover", filename: string) {
    setPdfLoading(type);
    setPdfError("");
    try {
      const result =
        type === "resume"
          ? await compilePdf(detail!.resume_tex)
          : await compileCoverLetterPdf(detail!.cover_letter);
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
    <>
      <Header
        title="Resume Dashboard"
        action={
          <Link
            href="/generate"
            className="bg-[#4051b5] hover:bg-[#4051b5]/90 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-all"
          >
            <span className="material-symbols-outlined text-[20px]">add</span>
            New Resume
          </Link>
        }
      />

      <div className="p-8 max-w-7xl mx-auto w-full">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <StatCard
            icon="article"
            iconBg="bg-indigo-50 text-indigo-600"
            label="Total Resumes"
            value={stats?.total ?? 0}
          />
          <StatCard
            icon="speed"
            iconBg="bg-green-50 text-green-600"
            label="Avg. ATS Score"
            value={stats?.avg_score ? `${stats.avg_score}%` : "N/A"}
          />
          <StatCard
            icon="send"
            iconBg="bg-amber-50 text-amber-600"
            label="Active Applications"
            value={
              (stats?.by_status?.applied ?? 0) +
              (stats?.by_status?.interview ?? 0)
            }
          />
        </div>

        {/* History Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-bold text-lg">Application History</h3>
          </div>

          {loading ? (
            <div className="p-12 text-center text-slate-500">Loading...</div>
          ) : error ? (
            <div className="p-12 text-center">
              <p className="text-red-500 mb-2">{error}</p>
              <p className="text-sm text-slate-500">
                Make sure the API server is running:{" "}
                <code className="bg-slate-100 px-2 py-0.5 rounded">
                  uvicorn api.server:app --reload
                </code>
              </p>
            </div>
          ) : records.length === 0 ? (
            <div className="p-12 text-center">
              <span className="material-symbols-outlined text-4xl text-slate-300 block mb-4">
                description
              </span>
              <p className="text-slate-500 mb-4">No resumes generated yet</p>
              <Link
                href="/generate"
                className="inline-flex items-center gap-2 bg-[#4051b5] text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                Generate Your First Resume
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                    <th className="px-6 py-4 font-semibold w-8"></th>
                    <th className="px-6 py-4 font-semibold">Company</th>
                    <th className="px-6 py-4 font-semibold">Role</th>
                    <th className="px-6 py-4 font-semibold">Date</th>
                    <th className="px-6 py-4 font-semibold">ATS Score</th>
                    <th className="px-6 py-4 font-semibold">Status</th>
                    <th className="px-6 py-4 font-semibold">Files</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {records.map((r) => (
                    <>
                      <tr
                        key={r.id}
                        onClick={() => handleExpand(r.id)}
                        className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                      >
                        <td className="pl-6 py-4">
                          <span
                            className={`material-symbols-outlined text-slate-400 text-[18px] transition-transform ${
                              expandedId === r.id ? "rotate-90" : ""
                            }`}
                          >
                            chevron_right
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="size-8 rounded bg-slate-100 flex items-center justify-center font-bold text-xs text-[#4051b5]">
                              {r.company.charAt(0).toUpperCase()}
                            </div>
                            <span className="font-medium">{r.company}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-600">{r.job_title}</td>
                        <td className="px-6 py-4 text-sm text-slate-500">
                          {r.timestamp.slice(0, 10)}
                        </td>
                        <td className="px-6 py-4">
                          {r.ats_scores.overall != null ? (
                            <span className="text-sm font-bold">{r.ats_scores.overall}%</span>
                          ) : (
                            <span className="text-sm text-slate-400">N/A</span>
                          )}
                        </td>
                        <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                          <select
                            value={r.status}
                            onChange={(e) => handleStatusChange(r.id, e.target.value)}
                            className={`text-xs font-medium px-2.5 py-1 rounded-full border-none cursor-pointer ${
                              STATUS_COLORS[r.status] || "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {STATUS_OPTIONS.map((s) => (
                              <option key={s} value={s}>
                                {s.charAt(0).toUpperCase() + s.slice(1)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-1.5">
                            {r.has_resume && (
                              <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded">
                                LaTeX
                              </span>
                            )}
                            {r.has_cover_letter && (
                              <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded">
                                CL
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Expanded detail row */}
                      {expandedId === r.id && (
                        <tr key={`${r.id}-detail`}>
                          <td colSpan={7} className="p-0">
                            <div className="bg-slate-50 border-t border-slate-200">
                              {detailLoading ? (
                                <div className="p-8 text-center text-slate-500">
                                  <div className="animate-spin size-6 border-2 border-[#4051b5]/20 border-t-[#4051b5] rounded-full mx-auto mb-2" />
                                  Loading content...
                                </div>
                              ) : !detail?.resume_tex && !detail?.cover_letter ? (
                                <div className="p-8 text-center text-slate-400">
                                  <span className="material-symbols-outlined text-3xl block mb-2">
                                    info
                                  </span>
                                  No content saved for this record (generated before content saving was enabled).
                                </div>
                              ) : (
                                <div className="p-6">
                                  {/* Action buttons */}
                                  <div className="flex flex-wrap gap-3 mb-4">
                                    {detail?.resume_tex && (
                                      <button
                                        onClick={() =>
                                          downloadFile(
                                            detail.resume_tex,
                                            `${r.company}_${r.job_title}.tex`.replace(/\s+/g, "_")
                                          )
                                        }
                                        className="inline-flex items-center gap-1.5 bg-[#4051b5] text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-[#4051b5]/90 transition-colors"
                                      >
                                        <span className="material-symbols-outlined text-[16px]">
                                          download
                                        </span>
                                        Download LaTeX
                                      </button>
                                    )}
                                    {detail?.resume_tex && (
                                      <button
                                        onClick={() =>
                                          handleDownloadPdf(
                                            "resume",
                                            `${r.company}_${r.job_title}.pdf`.replace(/\s+/g, "_")
                                          )
                                        }
                                        disabled={pdfLoading !== null}
                                        className="inline-flex items-center gap-1.5 bg-red-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
                                      >
                                        <span className="material-symbols-outlined text-[16px]">
                                          picture_as_pdf
                                        </span>
                                        {pdfLoading === "resume" ? "Compiling..." : "Resume PDF"}
                                      </button>
                                    )}
                                    {detail?.cover_letter && (
                                      <button
                                        onClick={() =>
                                          downloadFile(
                                            detail.cover_letter,
                                            `${r.company}_${r.job_title}_cover_letter.txt`.replace(
                                              /\s+/g,
                                              "_"
                                            )
                                          )
                                        }
                                        className="inline-flex items-center gap-1.5 bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700 transition-colors"
                                      >
                                        <span className="material-symbols-outlined text-[16px]">
                                          download
                                        </span>
                                        Cover Letter TXT
                                      </button>
                                    )}
                                    {detail?.cover_letter && (
                                      <button
                                        onClick={() =>
                                          handleDownloadPdf(
                                            "cover",
                                            `${r.company}_${r.job_title}_cover_letter.pdf`.replace(/\s+/g, "_")
                                          )
                                        }
                                        disabled={pdfLoading !== null}
                                        className="inline-flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
                                      >
                                        <span className="material-symbols-outlined text-[16px]">
                                          picture_as_pdf
                                        </span>
                                        {pdfLoading === "cover" ? "Compiling..." : "Cover Letter PDF"}
                                      </button>
                                    )}
                                  </div>

                                  {pdfError && (
                                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-xs">
                                      {pdfError}
                                    </div>
                                  )}

                                  {/* Content tabs */}
                                  <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                                    <div className="flex border-b border-slate-200">
                                      {detail?.resume_tex && (
                                        <button
                                          onClick={() => setDetailTab("resume")}
                                          className={`px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
                                            detailTab === "resume"
                                              ? "border-[#4051b5] text-[#4051b5]"
                                              : "border-transparent text-slate-500 hover:text-slate-700"
                                          }`}
                                        >
                                          Resume (LaTeX)
                                        </button>
                                      )}
                                      {detail?.cover_letter && (
                                        <button
                                          onClick={() => setDetailTab("cover")}
                                          className={`px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
                                            detailTab === "cover"
                                              ? "border-[#4051b5] text-[#4051b5]"
                                              : "border-transparent text-slate-500 hover:text-slate-700"
                                          }`}
                                        >
                                          Cover Letter
                                        </button>
                                      )}
                                    </div>
                                    <div className="max-h-[400px] overflow-auto">
                                      {detailTab === "resume" ? (
                                        <pre className="p-4 text-xs leading-relaxed font-mono text-slate-700 whitespace-pre-wrap">
                                          {detail?.resume_tex}
                                        </pre>
                                      ) : (
                                        <div className="p-4 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
                                          {detail?.cover_letter}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* CTA */}
        <div className="mt-8">
          <div className="bg-gradient-to-r from-[#4051b5] to-indigo-600 rounded-xl p-8 text-white relative overflow-hidden">
            <div className="relative z-10">
              <h3 className="text-2xl font-bold mb-2">Ready to land your next role?</h3>
              <p className="text-indigo-100 max-w-md mb-6">
                Our AI analyzes your experience to generate high-scoring resumes tailored
                for specific jobs in seconds.
              </p>
              <Link
                href="/generate"
                className="bg-white text-[#4051b5] px-6 py-2.5 rounded-lg font-bold inline-flex items-center gap-2 hover:bg-slate-50 transition-colors"
              >
                <span className="material-symbols-outlined">rocket_launch</span>
                Start New Generator
              </Link>
            </div>
            <span className="material-symbols-outlined absolute -right-8 -bottom-8 text-[200px] text-white/10 rotate-12">
              auto_awesome
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

function StatCard({
  icon,
  iconBg,
  label,
  value,
}: {
  icon: string;
  iconBg: string;
  label: string;
  value: string | number;
}) {
  return (
    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
      <div className="flex items-center gap-4">
        <div className={`size-12 rounded-lg flex items-center justify-center ${iconBg}`}>
          <span className="material-symbols-outlined text-[28px]">{icon}</span>
        </div>
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
      </div>
    </div>
  );
}
