export type ServiceName = "api" | "worker";

export interface ServerObservabilityConfig {
  readonly NODE_ENV: "development" | "production" | "test";
  readonly OBSERVABILITY_EXPORT_TIMEOUT_MS: number;
  readonly OTEL_EXPORTER_OTLP_ENDPOINT?: string | undefined;
  readonly SENTRY_DSN?: string | undefined;
}

export interface TelemetryContext {
  readonly actionId?: string;
  readonly attempt?: number;
  readonly correlationId?: string;
  readonly eventId?: string;
  readonly jobId?: string;
  readonly jobName?: string;
  readonly matchId?: string;
  readonly method?: string;
  readonly outcome?: string;
  readonly route?: string;
  readonly sequence?: number;
  readonly socketId?: string;
  readonly statusCode?: number;
  readonly userId?: string;
}

export interface SpanHandle {
  end(): void;
  fail(code: string): void;
}

export interface TelemetryAdapter {
  captureException(code: string, context: TelemetryContext): void;
  recordMetric(name: MetricName, value: number, context: TelemetryContext): void;
  shutdown(): Promise<void>;
  startSpan(name: string, context: TelemetryContext): SpanHandle;
}

export type MetricName =
  | "db.client.connections"
  | "game.actions"
  | "http.server.duration"
  | "outbox.delivery.delay"
  | "socket.connections"
  | "worker.jobs";

export interface Observability {
  captureException(code: string, context?: TelemetryContext): void;
  recordAction(outcome: "accepted" | "rejected", context: TelemetryContext): void;
  recordHttp(durationMs: number, context: TelemetryContext): void;
  recordJob(outcome: "completed" | "failed", context: TelemetryContext): void;
  recordOutboxDelay(delayMs: number, context: TelemetryContext): void;
  recordPool(state: "idle" | "total" | "waiting", value: number): void;
  recordSocketConnection(delta: -1 | 1, context: TelemetryContext): void;
  shutdown(): Promise<void>;
  startSpan(name: string, context?: TelemetryContext): SpanHandle;
  withSpan<T>(name: string, context: TelemetryContext, operation: () => Promise<T>): Promise<T>;
}
