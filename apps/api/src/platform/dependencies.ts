import type { ApiConfig } from "@arquibancada-viva/config/api";
import {
  checkDatabaseConnection,
  createApiDatabase,
  type DatabaseRuntime,
} from "@arquibancada-viva/database";

export interface ApiDependencies {
  checkReadiness(): Promise<void>;
  close(): Promise<void>;
}

export function createApiDependencies(config: ApiConfig): ApiDependencies {
  const databaseRuntime: DatabaseRuntime = createApiDatabase(config);

  return {
    checkReadiness: () => checkDatabaseConnection(databaseRuntime.database),
    close: () => databaseRuntime.close(),
  };
}
