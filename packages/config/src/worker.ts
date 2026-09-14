import { z } from "zod";
import {
  type ConfigInput,
  logLevelSchema,
  nodeEnvironmentSchema,
  postgresUrlSchema,
  redisUrlSchema,
} from "./shared.js";
import { storageConfigShape } from "./storage.js";

export const workerConfigSchema = z
  .object({
    NODE_ENV: nodeEnvironmentSchema,
    LOG_LEVEL: logLevelSchema,
    DATABASE_URL: postgresUrlSchema,
    WORKER_DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
    REDIS_URL: redisUrlSchema,
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
    ...storageConfigShape,
  })
  .readonly();

export type WorkerConfig = z.infer<typeof workerConfigSchema>;

export function parseWorkerConfig(input: ConfigInput): WorkerConfig {
  return workerConfigSchema.parse(input);
}
