import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicId } from "./identifiers.js";
import { applyMigrations } from "./migrations.js";
import { createDatabaseRuntime, createMigrationDatabase, type DatabaseRuntime } from "./pool.js";
import { matchSequences, outboxMessages } from "./schema/index.js";
import { type DatabaseTransaction, nextMatchSequence, withTransaction } from "./transactions.js";

const adminDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://app:app@127.0.0.1:5432/arquibancada_viva";

const testRun = `${process.pid}_${Date.now().toString(36)}`.toLowerCase();
const emptyDatabaseName = `av_tft005_empty_${testRun}`;
const previousDatabaseName = `av_tft005_previous_${testRun}`;

function quoteDatabaseName(databaseName: string): string {
  if (!/^[a-z0-9_]+$/u.test(databaseName)) {
    throw new Error("Nome inseguro para banco temporário.");
  }
  return `"${databaseName}"`;
}

function databaseUrl(databaseName: string): string {
  const url = new URL(adminDatabaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function recordFixtureEvent(
  transaction: DatabaseTransaction,
  matchId: string,
  marker: string,
): Promise<bigint> {
  const sequence = await nextMatchSequence(transaction, matchId);
  await transaction.insert(outboxMessages).values({
    aggregateId: matchId,
    aggregateType: "match",
    eventId: createPublicId(),
    eventType: "fixture.recorded",
    occurredAt: new Date("2026-09-14T00:00:00.000Z"),
    payload: { marker },
    sequence,
  });
  return sequence;
}

describe("PostgreSQL foundation", () => {
  const adminPool = new Pool({
    application_name: "arquibancada-viva-integration-admin",
    connectionString: adminDatabaseUrl,
    max: 1,
  });
  let adminConnected = false;
  let applicationRuntime: DatabaseRuntime;
  let emptyRuntime: DatabaseRuntime;
  let previousRuntime: DatabaseRuntime;

  beforeAll(async () => {
    await adminPool.query("SELECT 1");
    adminConnected = true;
    await adminPool.query(`CREATE DATABASE ${quoteDatabaseName(emptyDatabaseName)}`);
    await adminPool.query(`CREATE DATABASE ${quoteDatabaseName(previousDatabaseName)}`);

    emptyRuntime = createMigrationDatabase(databaseUrl(emptyDatabaseName));
    applicationRuntime = createDatabaseRuntime("api", databaseUrl(emptyDatabaseName), 10);
    previousRuntime = createMigrationDatabase(databaseUrl(previousDatabaseName));

    await previousRuntime.pool.query(`
      CREATE TABLE public.supported_previous_state (
        id integer PRIMARY KEY,
        value text NOT NULL
      )
    `);
    await previousRuntime.pool.query(
      "INSERT INTO public.supported_previous_state (id, value) VALUES ($1, $2)",
      [1, "preserved"],
    );
  });

  afterAll(async () => {
    await Promise.allSettled([
      applicationRuntime?.close(),
      emptyRuntime?.close(),
      previousRuntime?.close(),
    ]);

    if (adminConnected) {
      for (const databaseName of [emptyDatabaseName, previousDatabaseName]) {
        await adminPool.query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
          [databaseName],
        );
        await adminPool.query(`DROP DATABASE IF EXISTS ${quoteDatabaseName(databaseName)}`);
      }
    }

    await adminPool.end();
  });

  it("applies the initial migration to an empty database and records it", async () => {
    await applyMigrations(emptyRuntime.database);

    const schemas = await emptyRuntime.pool.query<{ schema_name: string }>(`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name IN ('app', 'auth', 'drizzle')
      ORDER BY schema_name
    `);
    const migrationCount = await emptyRuntime.pool.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations",
    );

    expect(schemas.rows.map((row) => row.schema_name)).toEqual(["app", "auth", "drizzle"]);
    expect(migrationCount.rows[0]?.count).toBe(1);
  });

  it("reapplies migrations as a no-op without duplicating control records", async () => {
    await applyMigrations(emptyRuntime.database);

    const migrationCount = await emptyRuntime.pool.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations",
    );
    const tableCount = await emptyRuntime.pool.query<{ count: number }>(`
      SELECT count(*)::integer AS count
      FROM information_schema.tables
      WHERE table_schema = 'app'
        AND table_name IN ('match_sequences', 'outbox_messages')
    `);

    expect(migrationCount.rows[0]?.count).toBe(1);
    expect(tableCount.rows[0]?.count).toBe(2);
  });

  it("migrates the supported previous state without changing its data", async () => {
    await applyMigrations(previousRuntime.database);

    const previousState = await previousRuntime.pool.query<{ value: string }>(
      "SELECT value FROM public.supported_previous_state WHERE id = $1",
      [1],
    );

    expect(previousState.rows).toEqual([{ value: "preserved" }]);
  });

  it("rolls sequence and outbox back together when a transaction fails", async () => {
    const matchId = createPublicId();

    await expect(
      withTransaction(emptyRuntime.database, async (transaction) => {
        await recordFixtureEvent(transaction, matchId, "must-roll-back");
        throw new Error("forced rollback");
      }),
    ).rejects.toThrow("forced rollback");

    expect(
      await emptyRuntime.database
        .select()
        .from(matchSequences)
        .where(eq(matchSequences.matchId, matchId)),
    ).toEqual([]);
    expect(
      await emptyRuntime.database
        .select()
        .from(outboxMessages)
        .where(eq(outboxMessages.aggregateId, matchId)),
    ).toEqual([]);

    const firstSequence = await withTransaction(emptyRuntime.database, (transaction) =>
      recordFixtureEvent(transaction, matchId, "committed"),
    );
    const secondSequence = await withTransaction(emptyRuntime.database, (transaction) =>
      nextMatchSequence(transaction, matchId),
    );

    expect(firstSequence).toBe(1n);
    expect(secondSequence).toBe(2n);
  });

  it("allocates each sequence exactly once under concurrent writes", async () => {
    const matchId = createPublicId();
    const sequences = await Promise.all(
      Array.from({ length: 20 }, () =>
        withTransaction(applicationRuntime.database, (transaction) =>
          nextMatchSequence(transaction, matchId),
        ),
      ),
    );

    expect(sequences.toSorted((left, right) => Number(left - right))).toEqual(
      Array.from({ length: 20 }, (_, index) => BigInt(index + 1)),
    );
  });

  it("applies transaction-local statement and lock timeouts", async () => {
    const settings = await withTransaction(
      emptyRuntime.database,
      async (transaction) => {
        const result = await transaction.execute<{
          lock_timeout: string;
          statement_timeout: string;
        }>(sql`
          select
            current_setting('lock_timeout') as lock_timeout,
            current_setting('statement_timeout') as statement_timeout
        `);
        return result.rows[0];
      },
      { lockTimeoutMs: 1_234, statementTimeoutMs: 2_345 },
    );

    expect(settings).toEqual({ lock_timeout: "1234ms", statement_timeout: "2345ms" });
  });
});
