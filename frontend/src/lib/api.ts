const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function fetchAPI(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...options,
  });
  if (res.status === 401) {
    // Redirect to login on auth failure (client-side only)
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new Error("Not authenticated");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "API request failed");
  }
  return res.json();
}

export async function getHealth() {
  return fetchAPI("/api/health");
}

export async function getProfile() {
  return fetchAPI("/api/profile");
}

export async function updateProfile(profile: Record<string, any>) {
  return fetchAPI("/api/profile", {
    method: "PUT",
    body: JSON.stringify(profile),
  });
}

export async function updatePersonal(personal: Record<string, any>) {
  return fetchAPI("/api/profile/personal", {
    method: "PUT",
    body: JSON.stringify(personal),
  });
}

export async function updateSkills(skills: Record<string, any>) {
  return fetchAPI("/api/profile/skills", {
    method: "PUT",
    body: JSON.stringify(skills),
  });
}

export async function addExperience(data: Record<string, any>) {
  return fetchAPI("/api/profile/experience", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteExperience(expId: string) {
  return fetchAPI(`/api/profile/experience/${expId}`, { method: "DELETE" });
}

export async function addProject(data: Record<string, any>) {
  return fetchAPI("/api/profile/project", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteProject(projId: string) {
  return fetchAPI(`/api/profile/project/${projId}`, { method: "DELETE" });
}

export async function getTemplates() {
  return fetchAPI("/api/templates");
}

export async function parseJD(jdText: string) {
  return fetchAPI("/api/parse-jd", {
    method: "POST",
    body: JSON.stringify({ jd_text: jdText }),
  });
}

export async function retrieveBullets(jdAnalysis: Record<string, any>, topK = 12) {
  return fetchAPI("/api/retrieve-bullets", {
    method: "POST",
    body: JSON.stringify({ jd_analysis: jdAnalysis, top_k: topK }),
  });
}

export async function generateResume(
  filteredProfile: Record<string, any>,
  jdAnalysis: Record<string, any>,
  template = "classic",
  generateCoverLetter = true
) {
  return fetchAPI("/api/generate", {
    method: "POST",
    body: JSON.stringify({
      filtered_profile: filteredProfile,
      jd_analysis: jdAnalysis,
      template,
      generate_cover_letter: generateCoverLetter,
    }),
  });
}

export async function scoreResume(
  resumeTex: string,
  jdAnalysis: Record<string, any>
) {
  return fetchAPI("/api/score", {
    method: "POST",
    body: JSON.stringify({ resume_tex: resumeTex, jd_analysis: jdAnalysis }),
  });
}

export async function refineResume(
  resumeTex: string,
  atsFeedback: Record<string, any>,
  jdAnalysis: Record<string, any>,
  filteredProfile: Record<string, any>
) {
  return fetchAPI("/api/refine", {
    method: "POST",
    body: JSON.stringify({
      resume_tex: resumeTex,
      ats_feedback: atsFeedback,
      jd_analysis: jdAnalysis,
      filtered_profile: filteredProfile,
    }),
  });
}

export async function generateFull(
  jdText: string,
  template = "classic",
  topK = 12,
  coverLetter = true
) {
  return fetchAPI("/api/generate-full", {
    method: "POST",
    body: JSON.stringify({
      jd_text: jdText,
      template,
      top_k: topK,
      generate_cover_letter: coverLetter,
    }),
  });
}

export async function getHistory() {
  return fetchAPI("/api/history");
}

export async function saveHistory(
  jdAnalysis: Record<string, any>,
  atsScores: Record<string, any>,
  template: string,
  resumeTex: string,
  coverLetter: string
) {
  return fetchAPI("/api/history", {
    method: "POST",
    body: JSON.stringify({
      jd_analysis: jdAnalysis,
      ats_scores: atsScores,
      template,
      resume_tex: resumeTex,
      cover_letter: coverLetter,
    }),
  });
}

export async function importProfileFromFile() {
  return fetchAPI("/api/profile/import-file", { method: "POST" });
}

export async function getHistoryRecord(recordId: number) {
  return fetchAPI(`/api/history/${recordId}`);
}

export async function compilePdf(resumeTex: string) {
  return fetchAPI("/api/compile-pdf", {
    method: "POST",
    body: JSON.stringify({ resume_tex: resumeTex }),
  });
}

export async function compileCoverLetterPdf(coverLetter: string) {
  return fetchAPI("/api/compile-cover-letter-pdf", {
    method: "POST",
    body: JSON.stringify({ cover_letter: coverLetter }),
  });
}

export async function updateHistoryStatus(recordId: number, status: string) {
  return fetchAPI(`/api/history/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export async function searchJobs(
  query: string,
  location = "canada",
  maxResults = 20,
  topN = 10
) {
  return fetchAPI("/api/search-jobs", {
    method: "POST",
    body: JSON.stringify({
      query,
      location,
      max_results: maxResults,
      top_n: topN,
    }),
  });
}
