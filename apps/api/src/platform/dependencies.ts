import type { ApiConfig } from "@arquibancada-viva/config/api";
import {
  type Database,
  checkDatabaseConnection,
  createApiDatabase,
  type DatabaseRuntime,
} from "@arquibancada-viva/database";
import { createS3ObjectStorage, type ObjectStorage } from "@arquibancada-viva/storage";
import {
  noopObservability,
  type Observability,
  settleWithin,
} from "@arquibancada-viva/observability";

export interface ApiDependencies {
  checkReadiness(): Promise<ApiReadiness>;
  close(): Promise<void>;
}

export interface ApiReadiness {
  readonly postgres: "down" | "up";
  readonly redis: "down" | "up";
  readonly storage: "down" | "up";
}

export type ApiShutdownTask = () => Promise<void>;

export interface ApiRuntimeDependencies extends ApiDependencies {
  readonly database: Database;
  readonly objectStorage: ObjectStorage;
  registerRedisReadiness(check: () => Promise<void>): void;
  registerShutdown(task: ApiShutdownTask): void;
}

export function isApiRuntimeDependencies(
  dependencies: ApiDependencies,
): dependencies is ApiRuntimeDependencies {
  return (
    "database" in dependencies &&
    "objectStorage" in dependencies &&
    "registerRedisReadiness" in dependencies &&
    "registerShutdown" in dependencies
  );
}

export function createApiDependencies(
  config: ApiConfig,
  observability: Observability = noopObservability,
): ApiRuntimeDependencies {
  const databaseRuntime: DatabaseRuntime = createApiDatabase(config);
  const objectStorage = createS3ObjectStorage(config);
  const shutdownTasks: ApiShutdownTask[] = [];
  const redisReadinessChecks: (() => Promise<void>)[] = [];
  let closePromise: Promise<void> | undefined;

  return {
    async checkReadiness() {
      observability.recordPool("total", databaseRuntime.pool.totalCount);
      observability.recordPool("idle", databaseRuntime.pool.idleCount);
      observability.recordPool("waiting", databaseRuntime.pool.waitingCount);
      const [postgres, redis, storage] = await Promise.allSettled([
        checkDatabaseConnection(databaseRuntime.database),
        redisReadinessChecks.length > 0
          ? Promise.all(redisReadinessChecks.map((check) => check()))
          : Promise.reject(new Error("Redis não registrado.")),
        objectStorage.checkConnection(),
      ]);
      return {
        postgres: postgres.status === "fulfilled" ? "up" : "down",
        redis: redis.status === "fulfilled" ? "up" : "down",
        storage: storage.status === "fulfilled" ? "up" : "down",
      };
    },
    close() {
      closePromise ??= settleWithin(
        (async () => {
          const failures: unknown[] = [];
          for (const task of shutdownTasks.toReversed()) {
            try {
              await task();
            } catch (error) {
              failures.push(error);
            }
          }
          try {
            await objectStorage.close();
          } catch (error) {
            failures.push(error);
          }
          try {
            await databaseRuntime.close();
          } catch (error) {
            failures.push(error);
          }
          if (failures.length > 0) {
            throw new AggregateError(failures, "Falha ao encerrar recursos da API.");
          }
        })(),
        config.SHUTDOWN_TIMEOUT_MS,
      );
      return closePromise;
    },
    database: databaseRuntime.database,
    objectStorage,
    registerRedisReadiness(check) {
      redisReadinessChecks.push(check);
    },
    registerShutdown(task) {
      if (closePromise) {
        throw new Error("A API já iniciou o encerramento.");
      }
      shutdownTasks.push(task);
    },
  };
}
