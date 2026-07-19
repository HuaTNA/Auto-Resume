/**
 * Resolve the API origin.
 *
 * Production uses same-origin `/api` requests and Next.js rewrites them to the
 * Cloud Run backend. This keeps authentication cookies first-party. Local
 * development continues to talk directly to FastAPI on port 8000.
 */
export function getApiBase(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
  }

  if (typeof window !== "undefined") {
    const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    return isLocal
      ? `${window.location.protocol}//${window.location.hostname}:8000`
      : "";
  }

  return process.env.NODE_ENV === "production" ? "" : "http://127.0.0.1:8000";
}

