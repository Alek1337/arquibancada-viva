import type { WorkerConfig } from "@arquibancada-viva/config/worker";
import {
  checkDatabaseConnection,
  createWorkerDatabase,
  type DatabaseRuntime,
} from "@arquibancada-viva/database";

export interface WorkerDependencies {
  checkReadiness(): Promise<void>;
  close(): Promise<void>;
}

export function createWorkerDependencies(config: WorkerConfig): WorkerDependencies {
  const databaseRuntime: DatabaseRuntime = createWorkerDatabase(config);

  return {
    checkReadiness: () => checkDatabaseConnection(databaseRuntime.database),
    close: () => databaseRuntime.close(),
  };
}
