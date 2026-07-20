import { getApiBase } from "./api-base";

async function fetchAPI(path: string, options?: RequestInit) {
  const res = await fetch(`${getApiBase()}${path}`, {
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

export async function getProfileCompleteness() {
  return fetchAPI("/api/profile/completeness");
}

export async function createGenerationJob(jdText: string, template: string, generateCoverLetter: boolean, idempotencyKey: string) {
  return fetchAPI("/api/generation-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ jd_text: jdText, template, top_k: 12, generate_cover_letter: generateCoverLetter }),
  });
}

export async function getGenerationJob(jobId: string) {
  return fetchAPI(`/api/generation-jobs/${jobId}`);
}

export async function updateProfile(profile: object) {
  return fetchAPI("/api/profile", {
    method: "PUT",
    body: JSON.stringify(profile),
  });
}

export async function updatePersonal(personal: object) {
  return fetchAPI("/api/profile/personal", {
    method: "PUT",
    body: JSON.stringify(personal),
  });
}

export async function updateSkills(skills: object) {
  return fetchAPI("/api/profile/skills", {
    method: "PUT",
    body: JSON.stringify(skills),
  });
}

export async function addExperience(data: object) {
  return fetchAPI("/api/profile/experience", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateExperience(expId: string, data: object) {
  return fetchAPI(`/api/profile/experience/${expId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteExperience(expId: string) {
  return fetchAPI(`/api/profile/experience/${expId}`, { method: "DELETE" });
}

export async function addProject(data: object) {
  return fetchAPI("/api/profile/project", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateProject(projId: string, data: object) {
  return fetchAPI(`/api/profile/project/${projId}`, {
    method: "PUT",
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

export async function retrieveBullets(jdAnalysis: object, topK = 12) {
  return fetchAPI("/api/retrieve-bullets", {
    method: "POST",
    body: JSON.stringify({ jd_analysis: jdAnalysis, top_k: topK }),
  });
}

export async function generateResume(
  filteredProfile: object,
  jdAnalysis: object,
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
  jdAnalysis: object
) {
  return fetchAPI("/api/score", {
    method: "POST",
    body: JSON.stringify({ resume_tex: resumeTex, jd_analysis: jdAnalysis }),
  });
}

export async function refineResume(
  resumeTex: string,
  atsFeedback: object,
  jdAnalysis: object,
  filteredProfile: object
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
  jdAnalysis: object,
  atsScores: object,
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

export async function importProfileFromFile(data: Record<string, unknown>) {
  return fetchAPI("/api/profile/import-upload", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getHistoryRecord(recordId: number) {
  return fetchAPI(`/api/history/${recordId}`);
}

export async function compilePdf(recordId: number) {
  return fetchAPI("/api/compile-pdf", {
    method: "POST",
    body: JSON.stringify({ record_id: recordId }),
  });
}

export async function compileCoverLetterPdf(recordId: number) {
  return fetchAPI("/api/compile-cover-letter-pdf", {
    method: "POST",
    body: JSON.stringify({ record_id: recordId }),
  });
}

export async function updateHistoryStatus(recordId: number, status: string) {
  return fetchAPI(`/api/history/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export async function generateSuggestedMaterials(recordId: number) {
  return fetchAPI(`/api/career/history/${recordId}/generate-materials`, { method: "POST" });
}

export async function approveApplication(recordId: number) {
  return fetchAPI(`/api/career/history/${recordId}/approve`, { method: "POST" });
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
