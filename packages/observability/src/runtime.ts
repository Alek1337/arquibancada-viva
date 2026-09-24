import { metrics, SpanStatusCode, trace, type Attributes } from "@opentelemetry/api";
import { createObservability } from "./observability.js";
import type {
  MetricName,
  Observability,
  ServerObservabilityConfig,
  ServiceName,
  TelemetryAdapter,
  TelemetryContext,
} from "./types.js";

const VERSION = "0.0.0";

interface TelemetrySdk {
  shutdown(): Promise<void>;
  start(): void;
}

type SentryModule = typeof import("@sentry/node");

function attributes(context: TelemetryContext): Attributes {
  return Object.fromEntries(
    Object.entries(context).filter((entry): entry is [string, string | number | boolean] => {
      const value = entry[1];
      return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
    }),
  );
}

function signalUrl(endpoint: string, signal: "metrics" | "traces"): string {
  const base = endpoint.endsWith("/") ? endpoint : `${endpoint}/`;
  return new URL(`v1/${signal}`, base).toString();
}

function createOpenTelemetryAdapter(
  serviceName: ServiceName,
  sdk: TelemetrySdk | undefined,
): TelemetryAdapter {
  const meter = metrics.getMeter(`arquibancada-viva-${serviceName}`, VERSION);
  const tracer = trace.getTracer(`arquibancada-viva-${serviceName}`, VERSION);
  const instruments = {
    "db.client.connections": meter.createHistogram("db.client.connections", {
      unit: "connections",
    }),
    "game.actions": meter.createCounter("game.actions"),
    "http.server.duration": meter.createHistogram("http.server.duration", { unit: "ms" }),
    "outbox.delivery.delay": meter.createHistogram("outbox.delivery.delay", { unit: "ms" }),
    "socket.connections": meter.createUpDownCounter("socket.connections"),
    "worker.jobs": meter.createCounter("worker.jobs"),
  } satisfies Record<
    MetricName,
    {
      record?(value: number, attributes?: Attributes): void;
      add?(value: number, attributes?: Attributes): void;
    }
  >;

  return {
    captureException: () => undefined,
    recordMetric(name, value, context) {
      const instrument = instruments[name];
      if ("add" in instrument && instrument.add) {
        instrument.add(value, attributes(context));
      } else if ("record" in instrument && instrument.record) {
        instrument.record(value, attributes(context));
      }
    },
    shutdown: () => sdk?.shutdown() ?? Promise.resolve(),
    startSpan(name, context) {
      const span = tracer.startSpan(name, { attributes: attributes(context) });
      return {
        end: () => span.end(),
        fail(code) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: code });
        },
      };
    },
  };
}

function createSentryAdapter(
  sentry: SentryModule,
  dsn: string,
  environment: ServerObservabilityConfig["NODE_ENV"],
  timeoutMs: number,
): TelemetryAdapter {
  sentry.init({
    defaultIntegrations: false,
    dsn,
    environment,
    release: VERSION,
    sendDefaultPii: false,
  });
  return {
    captureException(code, context) {
      sentry.captureException(new Error(code), {
        contexts: { correlation: attributes(context) },
        tags: { error_code: code },
      });
    },
    recordMetric: () => undefined,
    shutdown: async () => {
      await sentry.close(timeoutMs);
    },
    startSpan: () => ({ end: () => undefined, fail: () => undefined }),
  };
}

export async function createServerObservability(
  config: ServerObservabilityConfig,
  serviceName: ServiceName,
): Promise<Observability> {
  const adapters: TelemetryAdapter[] = [];
  let sdk: TelemetrySdk | undefined;
  if (config.OTEL_EXPORTER_OTLP_ENDPOINT) {
    try {
      const [metricsExporter, tracesExporter, resources, sdkMetrics, sdkNode] = await Promise.all([
        import("@opentelemetry/exporter-metrics-otlp-http"),
        import("@opentelemetry/exporter-trace-otlp-http"),
        import("@opentelemetry/resources"),
        import("@opentelemetry/sdk-metrics"),
        import("@opentelemetry/sdk-node"),
      ]);
      sdk = new sdkNode.NodeSDK({
        metricReaders: [
          new sdkMetrics.PeriodicExportingMetricReader({
            exporter: new metricsExporter.OTLPMetricExporter({
              timeoutMillis: config.OBSERVABILITY_EXPORT_TIMEOUT_MS,
              url: signalUrl(config.OTEL_EXPORTER_OTLP_ENDPOINT, "metrics"),
            }),
            exportIntervalMillis: 10_000,
            exportTimeoutMillis: config.OBSERVABILITY_EXPORT_TIMEOUT_MS,
          }),
        ],
        resource: resources.defaultResource().merge(
          resources.resourceFromAttributes({
            "service.name": `arquibancada-viva-${serviceName}`,
            "service.version": VERSION,
          }),
        ),
        traceExporter: new tracesExporter.OTLPTraceExporter({
          timeoutMillis: config.OBSERVABILITY_EXPORT_TIMEOUT_MS,
          url: signalUrl(config.OTEL_EXPORTER_OTLP_ENDPOINT, "traces"),
        }),
      });
      sdk.start();
    } catch {
      sdk = undefined;
    }
  }
  adapters.push(createOpenTelemetryAdapter(serviceName, sdk));
  if (config.SENTRY_DSN) {
    try {
      const sentry = await import("@sentry/node");
      adapters.push(
        createSentryAdapter(
          sentry,
          config.SENTRY_DSN,
          config.NODE_ENV,
          config.OBSERVABILITY_EXPORT_TIMEOUT_MS,
        ),
      );
    } catch {
      // Sentry remains optional and cannot prevent application startup.
    }
  }
  return createObservability(adapters);
}
