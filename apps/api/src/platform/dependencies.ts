import type { ApiConfig } from "@arquibancada-viva/config/api";
import {
  type Database,
  checkDatabaseConnection,
  createApiDatabase,
  type DatabaseRuntime,
} from "@arquibancada-viva/database";
import { createS3ObjectStorage, type ObjectStorage } from "@arquibancada-viva/storage";

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
    "registerRedisReadiness" in dependencies &&
    "registerShutdown" in dependencies
  );
}

export function createApiDependencies(config: ApiConfig): ApiRuntimeDependencies {
  const databaseRuntime: DatabaseRuntime = createApiDatabase(config);
  const objectStorage = createS3ObjectStorage(config);
  const shutdownTasks: ApiShutdownTask[] = [];
  let redisReadiness: (() => Promise<void>) | undefined;
  let closePromise: Promise<void> | undefined;

  return {
    async checkReadiness() {
      const [postgres, redis, storage] = await Promise.allSettled([
        checkDatabaseConnection(databaseRuntime.database),
        redisReadiness ? redisReadiness() : Promise.reject(new Error("Redis não registrado.")),
        objectStorage.checkConnection(),
      ]);
      return {
        postgres: postgres.status === "fulfilled" ? "up" : "down",
        redis: redis.status === "fulfilled" ? "up" : "down",
        storage: storage.status === "fulfilled" ? "up" : "down",
      };
    },
    close() {
      closePromise ??= (async () => {
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
      })();
      return closePromise;
    },
    database: databaseRuntime.database,
    objectStorage,
    registerRedisReadiness(check) {
      if (redisReadiness) {
        throw new Error("A readiness do Redis já foi registrada.");
      }
      redisReadiness = check;
    },
    registerShutdown(task) {
      if (closePromise) {
        throw new Error("A API já iniciou o encerramento.");
      }
      shutdownTasks.push(task);
    },
  };
}
