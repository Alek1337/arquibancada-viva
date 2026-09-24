import { describe, expect, it, vi } from "vitest";
import { settleWithin, ShutdownTimeoutError } from "./lifecycle.js";
import { createObservability } from "./observability.js";
import type { MetricName, TelemetryAdapter, TelemetryContext } from "./types.js";

function recordingAdapter() {
  const captures: { code: string; context: TelemetryContext }[] = [];
  const metrics: { context: TelemetryContext; name: MetricName; value: number }[] = [];
  const spans: { context: TelemetryContext; failed?: string; name: string }[] = [];
  const adapter: TelemetryAdapter = {
    captureException: (code, context) => captures.push({ code, context }),
    recordMetric: (name, value, context) => metrics.push({ context, name, value }),
    shutdown: async () => undefined,
    startSpan(name, context) {
      const span: { context: TelemetryContext; failed?: string; name: string } = {
        context,
        name,
      };
      spans.push(span);
      return {
        end: () => undefined,
        fail: (code) => {
          span.failed = code;
        },
      };
    },
  };
  return { adapter, captures, metrics, spans };
}

describe("correlated observability", () => {
  it("keeps one correlation across the technical fixture journey", async () => {
    const recorded = recordingAdapter();
    const observability = createObservability([recorded.adapter]);
    const correlationId = "0199a7c0-4457-7b37-b043-00f18cab1234";

    await observability.withSpan("http.request", { correlationId, route: "/v1/fixture" }, () =>
      observability.withSpan(
        "outbox.publish",
        { correlationId, eventId: "0199a7c0-4457-7b37-b043-00f18cab1235" },
        () =>
          observability.withSpan(
            "worker.job",
            { correlationId, jobId: "technical-fixture-1", jobName: "technical.fixture" },
            async () => "published",
          ),
      ),
    );
    observability.recordSocketConnection(1, { correlationId, socketId: "socket-1" });

    expect(recorded.spans.map((span) => span.context.correlationId)).toEqual([
      correlationId,
      correlationId,
      correlationId,
    ]);
    expect(recorded.metrics[0]).toMatchObject({
      context: { correlationId, socketId: "socket-1" },
      name: "socket.connections",
      value: 1,
    });
  });

  it("does not expose arbitrary errors or sensitive URL values", () => {
    const recorded = recordingAdapter();
    const observability = createObservability([recorded.adapter]);

    observability.captureException("must-not-appear-secret", {
      route: "/v1/failure?token=must-not-appear-token",
    });
    const span = observability.startSpan("safe-span");
    span.fail("must-not-appear-secret");
    span.end();

    expect(JSON.stringify({ captures: recorded.captures, spans: recorded.spans })).not.toContain(
      "must-not-appear",
    );
    expect(recorded.captures).toEqual([
      { code: "UNEXPECTED_ERROR", context: { route: "/v1/failure" } },
    ]);
    expect(recorded.spans).toEqual([
      { context: {}, failed: "UNEXPECTED_ERROR", name: "safe-span" },
    ]);
  });

  it("keeps business work available when every exporter operation fails", async () => {
    const failure = () => {
      throw new Error("EXPORTER_UNAVAILABLE");
    };
    const adapter: TelemetryAdapter = {
      captureException: failure,
      recordMetric: failure,
      shutdown: async () => {
        throw new Error("EXPORTER_UNAVAILABLE");
      },
      startSpan: failure,
    };
    const observability = createObservability([adapter]);

    await expect(
      observability.withSpan("business.transaction", {}, async () => "committed"),
    ).resolves.toBe("committed");
    expect(() => observability.recordAction("accepted", {})).not.toThrow();
    expect(() => observability.captureException("EXPECTED_ERROR")).not.toThrow();
    await expect(observability.shutdown()).resolves.toBeUndefined();
  });

  it("bounds graceful shutdown", async () => {
    vi.useFakeTimers();
    try {
      const result = settleWithin(new Promise(() => undefined), 1_000);
      const rejection = expect(result).rejects.toBeInstanceOf(ShutdownTimeoutError);
      await vi.advanceTimersByTimeAsync(1_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});
