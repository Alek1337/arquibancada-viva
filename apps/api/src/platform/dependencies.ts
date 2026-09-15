import type { ApiConfig } from "@arquibancada-viva/config/api";
import {
  type Database,
  checkDatabaseConnection,
  createApiDatabase,
  type DatabaseRuntime,
} from "@arquibancada-viva/database";

export interface ApiDependencies {
  checkReadiness(): Promise<void>;
  close(): Promise<void>;
}

export type ApiShutdownTask = () => Promise<void>;

export interface ApiRuntimeDependencies extends ApiDependencies {
  readonly database: Database;
  registerShutdown(task: ApiShutdownTask): void;
}

export function isApiRuntimeDependencies(
  dependencies: ApiDependencies,
): dependencies is ApiRuntimeDependencies {
  return "database" in dependencies && "registerShutdown" in dependencies;
}

export function createApiDependencies(config: ApiConfig): ApiRuntimeDependencies {
  const databaseRuntime: DatabaseRuntime = createApiDatabase(config);
  const shutdownTasks: ApiShutdownTask[] = [];
  let closePromise: Promise<void> | undefined;

  return {
    checkReadiness: () => checkDatabaseConnection(databaseRuntime.database),
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
    registerShutdown(task) {
      if (closePromise) {
        throw new Error("A API já iniciou o encerramento.");
      }
      shutdownTasks.push(task);
    },
  };
}
