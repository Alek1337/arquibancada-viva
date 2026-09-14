import type { ApiConfig } from "@arquibancada-viva/config/api";
import type { WorkerConfig } from "@arquibancada-viva/config/worker";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema/index.js";

export type Database = NodePgDatabase<typeof schema>;
export type DatabaseProcess = "api" | "migration" | "worker";

export interface DatabaseRuntime {
  readonly database: Database;
  readonly pool: Pool;
  readonly process: DatabaseProcess;
  close(): Promise<void>;
}

const PROCESS_APPLICATION_NAMES = {
  api: "arquibancada-viva-api",
  migration: "arquibancada-viva-migration",
  worker: "arquibancada-viva-worker",
} as const satisfies Record<DatabaseProcess, string>;

export function createPoolConfig(
  process: DatabaseProcess,
  connectionString: string,
  maximumConnections: number,
): PoolConfig {
  if (!Number.isInteger(maximumConnections) || maximumConnections < 1) {
    throw new RangeError("maximumConnections deve ser um inteiro positivo.");
  }

  return {
    application_name: PROCESS_APPLICATION_NAMES[process],
    connectionString,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    max: maximumConnections,
  };
}

export function createDatabaseRuntime(
  process: DatabaseProcess,
  connectionString: string,
  maximumConnections: number,
): DatabaseRuntime {
  const pool = new Pool(createPoolConfig(process, connectionString, maximumConnections));
  const database = drizzle(pool, { schema });

  return {
    database,
    pool,
    process,
    close: () => pool.end(),
  };
}

export function createApiDatabase(
  config: Pick<ApiConfig, "API_DATABASE_POOL_MAX" | "DATABASE_URL">,
): DatabaseRuntime {
  return createDatabaseRuntime("api", config.DATABASE_URL, config.API_DATABASE_POOL_MAX);
}

export function createWorkerDatabase(
  config: Pick<WorkerConfig, "DATABASE_URL" | "WORKER_DATABASE_POOL_MAX">,
): DatabaseRuntime {
  return createDatabaseRuntime("worker", config.DATABASE_URL, config.WORKER_DATABASE_POOL_MAX);
}

export function createMigrationDatabase(connectionString: string): DatabaseRuntime {
  return createDatabaseRuntime("migration", connectionString, 1);
}
