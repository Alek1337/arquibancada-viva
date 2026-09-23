import {
  AUTH_LOG_REDACTION_PATHS,
  redactLogValue,
  sanitizeAuthLogPath,
} from "@arquibancada-viva/auth";
import type { ApiConfig } from "@arquibancada-viva/config/api";
import type { Writable } from "node:stream";

export function createApiLoggerOptions(logLevel: ApiConfig["LOG_LEVEL"], stream?: Writable) {
  return {
    level: logLevel,
    formatters: {
      log(value: Record<string, unknown>) {
        return redactLogValue(value) as Record<string, unknown>;
      },
    },
    redact: {
      censor: "[REDACTED]",
      paths: [...AUTH_LOG_REDACTION_PATHS],
    },
    serializers: {
      err(error: unknown) {
        const safe = redactLogValue(error) as { readonly name?: string };
        return {
          message: "[REDACTED]",
          stack: "[REDACTED]",
          type: safe.name ?? "Error",
        };
      },
      error(error: unknown) {
        return redactLogValue(error);
      },
      req(request: { readonly method: string; readonly url: string }) {
        return {
          method: request.method,
          path: sanitizeAuthLogPath(request.url),
        };
      },
      res(response: { readonly statusCode: number }) {
        return { statusCode: response.statusCode };
      },
    },
    ...(stream ? { stream } : {}),
  };
}
