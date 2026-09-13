import { z } from "zod";
import {
  type ConfigInput,
  httpUrlSchema,
  logLevelSchema,
  nodeEnvironmentSchema,
  portSchema,
  postgresUrlSchema,
  redisUrlSchema,
  serverSecretSchema,
} from "./shared.js";
import { storageConfigShape } from "./storage.js";

export const apiConfigSchema = z
  .object({
    NODE_ENV: nodeEnvironmentSchema,
    LOG_LEVEL: logLevelSchema,
    API_PORT: portSchema.default(3_001),
    WEB_ORIGIN: httpUrlSchema,
    DATABASE_URL: postgresUrlSchema,
    REDIS_URL: redisUrlSchema,
    AUTH_SECRET: serverSecretSchema,
    ...storageConfigShape,
  })
  .readonly();

export type ApiConfig = z.infer<typeof apiConfigSchema>;

export function parseApiConfig(input: ConfigInput): ApiConfig {
  return apiConfigSchema.parse(input);
}
