import type {
  MetricName,
  Observability,
  SpanHandle,
  TelemetryAdapter,
  TelemetryContext,
} from "./types.js";

const noopSpan: SpanHandle = { end: () => undefined, fail: () => undefined };
const safeErrorCode = /^[A-Z][A-Z0-9_]{0,63}$/u;
const sensitiveValue = /(?:authorization|cookie|password|secret|token|x-amz-)/iu;

function normalizeErrorCode(code: string): string {
  return safeErrorCode.test(code) ? code : "UNEXPECTED_ERROR";
}

function safeContext(context: TelemetryContext): TelemetryContext {
  return Object.fromEntries(
    Object.entries(context).flatMap(([key, value]) => {
      if (typeof value !== "string") {
        return [[key, value]];
      }
      const queryIndex = value.indexOf("?");
      const fragmentIndex = value.indexOf("#");
      const separators = [queryIndex, fragmentIndex].filter((index) => index >= 0);
      const normalized =
        key === "route" && separators.length > 0
          ? value.slice(0, Math.min(...separators)) || "/"
          : value;
      return [[key, sensitiveValue.test(normalized) ? "[REDACTED]" : normalized.slice(0, 200)]];
    }),
  ) as TelemetryContext;
}

export function createObservability(adapters: readonly TelemetryAdapter[] = []): Observability {
  function record(name: MetricName, value: number, context: TelemetryContext): void {
    const sanitized = safeContext(context);
    for (const adapter of adapters) {
      try {
        adapter.recordMetric(name, value, sanitized);
      } catch {
        // Telemetry is deliberately best-effort and never controls business flow.
      }
    }
  }

  return {
    captureException(code, context = {}) {
      const normalizedCode = normalizeErrorCode(code);
      const sanitized = safeContext(context);
      for (const adapter of adapters) {
        try {
          adapter.captureException(normalizedCode, sanitized);
        } catch {
          // Exporter failures must not escape into the application.
        }
      }
    },
    recordAction(outcome, context) {
      record("game.actions", 1, { ...context, outcome });
    },
    recordHttp(durationMs, context) {
      record("http.server.duration", durationMs, context);
    },
    recordJob(outcome, context) {
      record("worker.jobs", 1, { ...context, outcome });
    },
    recordOutboxDelay(delayMs, context) {
      record("outbox.delivery.delay", delayMs, context);
    },
    recordPool(state, value) {
      record("db.client.connections", value, { outcome: state });
    },
    recordSocketConnection(delta, context) {
      record("socket.connections", delta, context);
    },
    async shutdown() {
      await Promise.allSettled(adapters.map((adapter) => adapter.shutdown()));
    },
    startSpan(name, context = {}) {
      const handles: SpanHandle[] = [];
      const sanitized = safeContext(context);
      for (const adapter of adapters) {
        try {
          handles.push(adapter.startSpan(name, sanitized));
        } catch {
          // A missing exporter produces a no-op span.
        }
      }
      if (handles.length === 0) {
        return noopSpan;
      }
      return {
        end() {
          for (const handle of handles) {
            try {
              handle.end();
            } catch {
              // Span export remains best-effort.
            }
          }
        },
        fail(code) {
          const normalizedCode = normalizeErrorCode(code);
          for (const handle of handles) {
            try {
              handle.fail(normalizedCode);
            } catch {
              // Span export remains best-effort.
            }
          }
        },
      };
    },
    async withSpan(name, context, operation) {
      const span = this.startSpan(name, context);
      try {
        return await operation();
      } catch (error) {
        span.fail(error instanceof Error ? error.name : "UNKNOWN_ERROR");
        throw error;
      } finally {
        span.end();
      }
    },
  };
}

export const noopObservability = createObservability();
