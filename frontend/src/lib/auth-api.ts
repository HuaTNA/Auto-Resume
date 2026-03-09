const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function authFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Request failed");
  }
  return res.json();
}

export interface AuthUser {
  id: number;
  email: string;
  created_at: string;
}

export async function register(email: string, password: string): Promise<AuthUser> {
  return authFetch("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function login(email: string, password: string): Promise<AuthUser> {
  return authFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function logout(): Promise<void> {
  await authFetch("/api/auth/logout", { method: "POST" });
}

export async function getMe(): Promise<AuthUser | null> {
  try {
    return await authFetch("/api/auth/me");
  } catch {
    return null;
  }
}
