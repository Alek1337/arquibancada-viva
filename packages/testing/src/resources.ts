import {
  applyMigrations,
  createMigrationDatabase,
  createPublicId,
  type Database,
  type DatabaseRuntime,
} from "@arquibancada-viva/database";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const SAFE_PREFIX = /^[a-z][a-z0-9_]{0,31}$/u;

export function assertLocalTestUrl(rawUrl: string, protocols: readonly string[]): URL {
  const url = new URL(rawUrl);
  if (!protocols.includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(`TEST_TARGET_NOT_LOCAL:${url.protocol}//${url.host}`);
  }
  return url;
}

export function createTestRunId(prefix: string): string {
  if (!SAFE_PREFIX.test(prefix)) {
    throw new TypeError(
      "O prefixo do teste deve usar somente letras minúsculas, números e underscore.",
    );
  }
  return `${prefix}_${process.pid}_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
}

export function createTestPublicId(): string {
  return createPublicId();
}

export function databaseUrlForName(adminDatabaseUrl: string, databaseName: string): string {
  assertLocalTestUrl(adminDatabaseUrl, ["postgres:", "postgresql:"]);
  if (!/^[a-z][a-z0-9_]{0,62}$/u.test(databaseName)) {
    throw new TypeError("Nome inseguro para banco efêmero.");
  }
  const url = new URL(adminDatabaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

export interface EphemeralPostgresDatabase {
  close(): Promise<void>;
  readonly database: Database;
  readonly name: string;
  readonly runtime: DatabaseRuntime;
  readonly url: string;
}

export async function createEphemeralPostgresDatabase(input: {
  readonly adminDatabaseUrl: string;
  readonly prefix: string;
}): Promise<EphemeralPostgresDatabase> {
  const adminUrl = assertLocalTestUrl(input.adminDatabaseUrl, ["postgres:", "postgresql:"]);
  const name = createTestRunId(input.prefix).slice(0, 63);
  const url = databaseUrlForName(adminUrl.toString(), name);
  const adminPool = new Pool({
    application_name: "arquibancada-viva-test-admin",
    connectionString: adminUrl.toString(),
    max: 1,
  });
  await adminPool.query(`CREATE DATABASE "${name}"`);
  const runtime = createMigrationDatabase(url);
  try {
    await applyMigrations(runtime.database);
  } catch (error) {
    await runtime.close();
    await adminPool.query(`DROP DATABASE IF EXISTS "${name}"`);
    await adminPool.end();
    throw error;
  }

  let closePromise: Promise<void> | undefined;
  return {
    close() {
      closePromise ??= (async () => {
        await runtime.close();
        await adminPool.query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
          [name],
        );
        await adminPool.query(`DROP DATABASE IF EXISTS "${name}"`);
        await adminPool.end();
      })();
      return closePromise;
    },
    database: runtime.database,
    name,
    runtime,
    url,
  };
}

export function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0 || percentileValue < 0 || percentileValue > 100) {
    throw new RangeError("A amostra deve existir e o percentil deve ficar entre 0 e 100.");
  }
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.ceil((percentileValue / 100) * ordered.length) - 1;
  return ordered[Math.max(0, index)] as number;
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  options: { readonly intervalMs?: number; readonly timeoutMs?: number } = {},
): Promise<void> {
  const intervalMs = options.intervalMs ?? 25;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const deadline = performance.now() + timeoutMs;
  while (performance.now() <= deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("TEST_WAIT_TIMEOUT");
}
