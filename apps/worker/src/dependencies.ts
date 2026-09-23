import type { WorkerConfig } from "@arquibancada-viva/config/worker";
import {
  checkDatabaseConnection,
  createOutboxDispatcher,
  createWorkerDatabase,
  type DatabaseRuntime,
} from "@arquibancada-viva/database";
import { createS3ObjectStorage } from "@arquibancada-viva/storage";
import type { WorkerLogger } from "./logger.js";
import { createOutboxRecovery, type OutboxRecovery } from "./outbox/recovery.js";
import { createTechnicalQueue, type TechnicalQueueRuntime } from "./queue/technical-queue.js";
import {
  createRealtimeRedisPublisher,
  type RealtimeRedisPublisher,
} from "./realtime/redis-publisher.js";

export interface WorkerReadiness {
  readonly postgres: "down" | "up";
  readonly redis: "down" | "up";
  readonly storage: "down" | "up";
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
  const objectStorage = createS3ObjectStorage(config);
  const queueRuntime: TechnicalQueueRuntime = createTechnicalQueue({
    concurrency: config.WORKER_CONCURRENCY,
    database: databaseRuntime.database,
    logger,
    redisUrl: config.REDIS_URL,
  });
  const realtimePublisher: RealtimeRedisPublisher = createRealtimeRedisPublisher(config.REDIS_URL);
  const outboxRecovery: OutboxRecovery = createOutboxRecovery({
    dispatcher: createOutboxDispatcher(databaseRuntime.database, {
      publisher: realtimePublisher,
    }),
    logger,
  });
  let closePromise: Promise<void> | undefined;

  return {
    async checkReadiness() {
      const [postgres, queueRedis, realtimeRedis, storage] = await Promise.allSettled([
        checkDatabaseConnection(databaseRuntime.database),
        queueRuntime.checkConnection(),
        realtimePublisher.checkConnection(),
        objectStorage.checkConnection(),
      ]);
      return {
        postgres: postgres.status === "fulfilled" ? "up" : "down",
        redis:
          queueRedis.status === "fulfilled" && realtimeRedis.status === "fulfilled" ? "up" : "down",
        storage: storage.status === "fulfilled" ? "up" : "down",
      };
    },
    close() {
      if (!closePromise) {
        closePromise = (async () => {
          const results = await Promise.allSettled([
            outboxRecovery.close(),
            queueRuntime.close(),
            realtimePublisher.close(),
            objectStorage.close(),
          ]);
          await databaseRuntime.close();
          const failures = results.filter((result) => result.status === "rejected");
          if (failures.length > 0) {
            throw new AggregateError(
              failures.map((failure) => failure.reason),
              "Falha ao encerrar dependências do worker.",
            );
          }
        })();
      }
      return closePromise;
    },
    async start() {
      await checkDatabaseConnection(databaseRuntime.database);
      await Promise.all([
        queueRuntime.start(),
        realtimePublisher.start(),
        objectStorage.checkConnection(),
      ]);
      outboxRecovery.start();
    },
  };
}
