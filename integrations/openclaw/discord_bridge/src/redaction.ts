const SECRET_KEYS = /^(authorization|cookie|password|token|serviceToken|verificationCode|secret)$/i;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi;

export function redactForDiscord(value: unknown): unknown {
  if (typeof value === "string") return value.replace(BEARER_RE, "Bearer [REDACTED]");
  if (Array.isArray(value)) return value.map(redactForDiscord);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, SECRET_KEYS.test(key) ? "[REDACTED]" : redactForDiscord(item)]),
    );
  }
  return value;
}

export function safeErrorMessage(status: number, requestId?: string | null): string {
  return `Auto Resume API 请求失败（HTTP ${status}${requestId ? `，request ID: ${requestId}` : ""}）`;
}
