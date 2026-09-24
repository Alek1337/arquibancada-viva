import { z } from "zod";
import { httpUrlSchema } from "./shared";

export const observabilityConfigShape = {
  OBSERVABILITY_EXPORT_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(2_000),
  OTEL_EXPORTER_OTLP_ENDPOINT: httpUrlSchema.optional(),
  SENTRY_DSN: httpUrlSchema.optional(),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
} as const;

export interface ObservabilityConfig {
  readonly NODE_ENV: "development" | "production" | "test";
  readonly OBSERVABILITY_EXPORT_TIMEOUT_MS: number;
  readonly OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  readonly SENTRY_DSN?: string;
  readonly SHUTDOWN_TIMEOUT_MS: number;
}
