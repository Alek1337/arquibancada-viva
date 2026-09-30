import { setTimeout } from "node:timers/promises";
import type { Pool } from "pg";

/** Test-only cooperative teardown. Call only for databases created by this suite.
 * Pool.end resolves before pg's socket close event has necessarily reached the server.
 * Never terminate a backend: doing so can emit an unhandled 57P01 on a closing client.
 */
export async function dropIsolatedTestDatabase(pool: Pool, name: string): Promise<void> {
  if (!/^av_(?:tft005_(?:empty|previous)|met004)_[a-z0-9_]+$/u.test(name)) {
    throw new Error("Unsafe isolated test database name");
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await pool.query(`DROP DATABASE IF EXISTS "${name}"`);
      return;
    } catch (error) {
      if (
        attempt === 7 ||
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "55006"
      )
        throw error;
      await setTimeout(25 * (attempt + 1));
    }
  }
}
