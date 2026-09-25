import { z } from "zod";
import {
  type ConfigInput,
  bindHostSchema,
  httpUrlSchema,
  logLevelSchema,
  nodeEnvironmentSchema,
  portSchema,
  postgresUrlSchema,
  redisUrlSchema,
  serverSecretSchema,
} from "./shared";
import { storageConfigShape } from "./storage";
import { observabilityConfigShape } from "./observability";

const disabledByDefaultBooleanSchema = z
  .enum(["false", "true"])
  .default("false")
  .transform((value) => value === "true");

export const apiConfigSchema = z
  .object({
    NODE_ENV: nodeEnvironmentSchema,
    LOG_LEVEL: logLevelSchema,
    API_HOST: bindHostSchema.default("127.0.0.1"),
    API_PORT: portSchema.default(3_001),
    API_BODY_LIMIT_BYTES: z.coerce.number().int().min(1_024).max(1_048_576).default(65_536),
    WEB_ORIGIN: httpUrlSchema,
    AUTH_BASE_URL: httpUrlSchema,
    DATABASE_URL: postgresUrlSchema,
    API_DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
    REDIS_URL: redisUrlSchema,
    RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).max(10_000).default(10),
    RATE_LIMIT_GENERAL_MAX: z.coerce.number().int().min(1).max(100_000).default(120),
    RATE_LIMIT_MUTATION_MAX: z.coerce.number().int().min(1).max(10_000).default(30),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
    TECHNICAL_HARNESS_ENABLED: disabledByDefaultBooleanSchema,
    ...observabilityConfigShape,
    AUTH_SECRET: serverSecretSchema,
    ...storageConfigShape,
  })
  .superRefine((config, context) => {
    if (config.NODE_ENV === "production" && config.TECHNICAL_HARNESS_ENABLED) {
      context.addIssue({
        code: "custom",
        message: "TECHNICAL_HARNESS_ENABLED não pode ser ativado em production.",
        path: ["TECHNICAL_HARNESS_ENABLED"],
      });
    }
  })
  .readonly();

export type ApiConfig = z.infer<typeof apiConfigSchema>;

export function parseApiConfig(input: ConfigInput): ApiConfig {
  return apiConfigSchema.parse(input);
}
