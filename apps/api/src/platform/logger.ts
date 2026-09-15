import { AUTH_LOG_REDACTION_PATHS, sanitizeAuthLogPath } from "@arquibancada-viva/auth";
import type { ApiConfig } from "@arquibancada-viva/config/api";
import type { Writable } from "node:stream";

export function createApiLoggerOptions(logLevel: ApiConfig["LOG_LEVEL"], stream?: Writable) {
  return {
    level: logLevel,
    redact: {
      censor: "[REDACTED]",
      paths: [...AUTH_LOG_REDACTION_PATHS],
    },
    serializers: {
      req(request: { readonly method: string; readonly url: string }) {
        return {
          method: request.method,
          path: sanitizeAuthLogPath(request.url),
        };
      },
    },
    ...(stream ? { stream } : {}),
  };
}
