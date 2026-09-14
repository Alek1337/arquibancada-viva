import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Database } from "./pool.js";

export const MIGRATIONS_DIRECTORY = fileURLToPath(new URL("../migrations", import.meta.url));

export async function applyMigrations(
  database: Database,
  migrationsFolder = MIGRATIONS_DIRECTORY,
): Promise<void> {
  await migrate(database, {
    migrationsFolder,
    migrationsSchema: "drizzle",
    migrationsTable: "__drizzle_migrations",
  });
}
