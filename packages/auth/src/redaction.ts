const REDACTED = "[REDACTED]";
const CIRCULAR = "[CIRCULAR]";
const sensitiveKeys = new Set([
  "accesstoken",
  "authorization",
  "cookie",
  "email",
  "idtoken",
  "passcode",
  "password",
  "refreshtoken",
  "secret",
  "sessiontoken",
  "setcookie",
  "token",
]);
const safeErrorNames = new Set(["AggregateError", "Error", "RangeError", "TypeError"]);

export const AUTH_LOG_REDACTION_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "headers.authorization",
  "headers.cookie",
  "headers['set-cookie']",
  "req.body.email",
  "req.body.password",
  "req.body.passcode",
  "req.body.secret",
  "req.body.token",
  "req.body.sessionToken",
  "req.body.accessToken",
  "req.body.refreshToken",
  "req.body.idToken",
  "body.email",
  "body.password",
  "body.passcode",
  "body.secret",
  "body.token",
  "body.sessionToken",
  "body.accessToken",
  "body.refreshToken",
  "body.idToken",
] as const;

function normalizedKey(key: string): string {
  return key.replaceAll("-", "").replaceAll("_", "").replaceAll(".", "").toLowerCase();
}

function redact(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return CIRCULAR;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen));
  }
  if (value instanceof Error) {
    return { name: safeErrorNames.has(value.name) ? value.name : "Error" };
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      sensitiveKeys.has(normalizedKey(key)) ? REDACTED : redact(entry, seen),
    ]),
  );
}

export function redactAuthLogValue(value: unknown): unknown {
  return redact(value, new WeakSet());
}

export interface AuthRequestLogInput {
  readonly error?: unknown;
  readonly method: string;
  readonly statusCode?: number;
  readonly url: string;
}

export function sanitizeAuthLogPath(value: string): string {
  try {
    return new URL(value, "http://auth.local").pathname;
  } catch {
    const queryIndex = value.indexOf("?");
    const fragmentIndex = value.indexOf("#");
    const separatorIndexes = [queryIndex, fragmentIndex].filter((index) => index >= 0);
    const end = separatorIndexes.length > 0 ? Math.min(...separatorIndexes) : value.length;
    return value.slice(0, end) || "/invalid-auth-path";
  }
}

export function createAuthRequestLog(input: AuthRequestLogInput): Record<string, unknown> {
  return redactAuthLogValue({
    ...(input.error === undefined ? {} : { error: input.error }),
    event: input.error === undefined ? "auth.request_completed" : "auth.request_failed",
    method: input.method,
    ...(input.statusCode === undefined ? {} : { statusCode: input.statusCode }),
    path: sanitizeAuthLogPath(input.url),
  }) as Record<string, unknown>;
}
