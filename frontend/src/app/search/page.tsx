"use client";

import { useState } from "react";
import Header from "@/components/Header";
import { searchJobs } from "@/lib/api";

interface Job {
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  salary_min: number | null;
  salary_max: number | null;
  created: string;
  match_score: number;
  match_reason: string;
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("canada");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);

  async function handleSearch() {
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    setSearched(true);
    try {
      const data = await searchJobs(query, location);
      setJobs(data.jobs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  function getScoreColor(score: number) {
    if (score >= 85) return "bg-emerald-100 text-emerald-700 border-emerald-200";
    if (score >= 70) return "bg-blue-100 text-blue-700 border-blue-200";
    return "bg-amber-100 text-amber-700 border-amber-200";
  }

  return (
    <>
      <Header title="Job Search" />

      <div className="p-8 max-w-5xl mx-auto w-full">
        {/* Search bar */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex-1 relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              search
            </span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="w-full pl-10 pr-4 py-3 bg-slate-50 border-none rounded-lg text-slate-900 placeholder:text-slate-500 focus:ring-2 focus:ring-[#4051b5]"
              placeholder="Job title, keywords, or company"
            />
          </div>
          <div className="flex-1 relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              location_on
            </span>
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-slate-50 border-none rounded-lg text-slate-900 focus:ring-2 focus:ring-[#4051b5]"
            >
              <option value="canada">Canada</option>
              <option value="us">United States</option>
              <option value="uk">United Kingdom</option>
              <option value="australia">Australia</option>
              <option value="germany">Germany</option>
            </select>
          </div>
          <button
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            className="bg-[#4051b5] hover:bg-[#4051b5]/90 text-white px-8 py-3 rounded-lg font-bold transition-all shadow-md shadow-[#4051b5]/20 disabled:opacity-50"
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
            {error.includes("ADZUNA") && (
              <p className="mt-2 text-xs">
                Get free API keys at{" "}
                <a
                  href="https://developer.adzuna.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  developer.adzuna.com
                </a>
              </p>
            )}
          </div>
        )}

        {/* Results */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="animate-spin size-12 border-4 border-[#4051b5]/20 border-t-[#4051b5] rounded-full mb-6" />
            <p className="text-lg font-medium text-slate-700">
              Searching & ranking jobs by your profile...
            </p>
          </div>
        )}

        {!loading && searched && jobs.length === 0 && !error && (
          <div className="text-center py-20 text-slate-500">
            <span className="material-symbols-outlined text-4xl mb-4 block">search_off</span>
            <p>No jobs found. Try different keywords or location.</p>
          </div>
        )}

        <div className="flex flex-col gap-4">
          {jobs.map((job, i) => (
            <div
              key={i}
              className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:border-[#4051b5]/50 transition-all"
            >
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                <div className="flex gap-4">
                  <div className="size-14 rounded-lg bg-slate-100 flex items-center justify-center font-bold text-lg text-[#4051b5] shrink-0">
                    {job.company.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">{job.title}</h3>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-slate-500">
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-[18px]">business</span>
                        {job.company}
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-[18px]">location_on</span>
                        {job.location}
                      </span>
                      {job.salary_min && job.salary_max && (
                        <span className="flex items-center gap-1">
                          <span className="material-symbols-outlined text-[18px]">payments</span>
                          ${job.salary_min.toLocaleString()} - ${job.salary_max.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2">
                  <div
                    className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 border ${getScoreColor(
                      job.match_score
                    )}`}
                  >
                    <span className="material-symbols-outlined text-sm">bolt</span>
                    Match: {job.match_score}%
                  </div>
                  {job.created && (
                    <span className="text-xs text-slate-400">
                      {job.created.slice(0, 10)}
                    </span>
                  )}
                </div>
              </div>

              <p className="text-sm text-slate-600 mt-3 line-clamp-2">{job.description}</p>
              <p className="text-xs text-slate-500 mt-2 italic">{job.match_reason}</p>

              <div className="mt-4 flex gap-3">
                <a
                  href={job.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-[#4051b5] text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1 hover:bg-[#4051b5]/90 transition-all"
                >
                  <span className="material-symbols-outlined text-sm">open_in_new</span>
                  View Job
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
