import type { WorkerConfig } from "@arquibancada-viva/config/worker";
import {
  checkDatabaseConnection,
  createWorkerDatabase,
  type DatabaseRuntime,
} from "@arquibancada-viva/database";
import type { WorkerLogger } from "./logger.js";
import { createTechnicalQueue, type TechnicalQueueRuntime } from "./queue/technical-queue.js";

export interface WorkerReadiness {
  readonly postgres: "down" | "up";
  readonly redis: "down" | "up";
}

export interface WorkerDependencies {
  checkReadiness(): Promise<WorkerReadiness>;
  close(): Promise<void>;
  start(): Promise<void>;
}

export function createWorkerDependencies(
  config: WorkerConfig,
  logger: WorkerLogger,
): WorkerDependencies {
  const databaseRuntime: DatabaseRuntime = createWorkerDatabase(config);
  const queueRuntime: TechnicalQueueRuntime = createTechnicalQueue({
    concurrency: config.WORKER_CONCURRENCY,
    database: databaseRuntime.database,
    logger,
    redisUrl: config.REDIS_URL,
  });
  let closePromise: Promise<void> | undefined;

  return {
    async checkReadiness() {
      const [postgres, redis] = await Promise.allSettled([
        checkDatabaseConnection(databaseRuntime.database),
        queueRuntime.checkConnection(),
      ]);
      return {
        postgres: postgres.status === "fulfilled" ? "up" : "down",
        redis: redis.status === "fulfilled" ? "up" : "down",
      };
    },
    close() {
      if (!closePromise) {
        closePromise = queueRuntime.close().then(() => databaseRuntime.close());
      }
      return closePromise;
    },
    async start() {
      await checkDatabaseConnection(databaseRuntime.database);
      await queueRuntime.start();
    },
  };
}
