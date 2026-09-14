import { z } from "zod";
import {
  bindHostSchema,
  type ConfigInput,
  logLevelSchema,
  nodeEnvironmentSchema,
  postgresUrlSchema,
  redisUrlSchema,
} from "./shared";
import { storageConfigShape } from "./storage";

export const workerConfigSchema = z
  .object({
    NODE_ENV: nodeEnvironmentSchema,
    LOG_LEVEL: logLevelSchema,
    DATABASE_URL: postgresUrlSchema,
    WORKER_DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
    REDIS_URL: redisUrlSchema,
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
    WORKER_PROBE_HOST: bindHostSchema.default("127.0.0.1"),
    WORKER_PROBE_PORT: z.coerce.number().int().min(1).max(65_535).default(3_002),
    ...storageConfigShape,
  })
  .readonly();

export type WorkerConfig = z.infer<typeof workerConfigSchema>;

export function parseWorkerConfig(input: ConfigInput): WorkerConfig {
  return workerConfigSchema.parse(input);
}
