import { getApiBase } from "./api-base";

async function authFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${getApiBase()}${path}`, {
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

export async function getRegistrationConfig(): Promise<{ mode: "open" | "invite" | "closed" }> {
  return authFetch("/api/auth/registration-config");
}

export async function register(email: string, password: string, inviteCode?: string): Promise<AuthUser> {
  return authFetch("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, invite_code: inviteCode || null }),
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

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await authFetch("/api/auth/change-password", { method: "POST", body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) });
}

export async function exportAccount(): Promise<Record<string, unknown>> {
  return authFetch("/api/auth/export");
}

export async function deleteAccount(password: string): Promise<void> {
  await authFetch("/api/auth/account", { method: "DELETE", body: JSON.stringify({ password }) });
}
