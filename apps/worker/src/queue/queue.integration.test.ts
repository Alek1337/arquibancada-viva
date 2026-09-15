import { TECHNICAL_FIXTURE_JOB_NAME } from "@arquibancada-viva/contracts";
import {
  applyMigrations,
  countQueueFixtureEffects,
  createDatabaseRuntime,
  createMigrationDatabase,
  createOutboxDispatcher,
  createPublicId,
  deleteExpiredIdempotencyRecords,
  executeIdempotentCommand,
  getOutboxMessage,
  idempotencyRecords,
  IdempotencyConflictError,
  type Database,
  type DatabaseRuntime,
  type JsonObject,
  nextMatchSequence,
  recordOutboxMessage,
} from "@arquibancada-viva/database";
import type { Queue } from "bullmq";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkerLog } from "../logger.js";
import { createOutboxRecovery } from "../outbox/recovery.js";
import { QueueUnavailableError } from "./errors.js";
import {
  createTechnicalQueue,
  createTechnicalQueueProducer,
  type TechnicalQueueRuntime,
} from "./technical-queue.js";

const adminDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://app:app@127.0.0.1:5432/arquibancada_viva";
const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const testRun = `${process.pid}_${Date.now().toString(36)}`.toLowerCase();
const databaseName = `av_tft009_${testRun}`;
const queuePrefix = `av-tft009-${testRun}`;

interface FixtureCommandResponse extends JsonObject {
  readonly eventId: string;
  readonly matchId: string;
  readonly marker: string;
  readonly sequence: number;
}

interface FixtureCommandInput {
  readonly database: Database;
  readonly eventId?: string;
  readonly failBeforeCommit?: boolean;
  readonly idempotencyKey: string;
  readonly marker: string;
  readonly matchId: string;
  readonly now: Date;
  readonly onExecute?: () => void;
}

async function executeFixtureCommand(
  input: FixtureCommandInput,
): Promise<{ replayed: boolean; value: FixtureCommandResponse }> {
  return executeIdempotentCommand(input.database, {
    key: input.idempotencyKey,
    now: input.now,
    operation: async (transaction) => {
      input.onExecute?.();
      const eventId = input.eventId ?? createPublicId(input.now.getTime());
      const sequence = await nextMatchSequence(transaction, input.matchId);
      await recordOutboxMessage(transaction, {
        aggregateId: input.matchId,
        aggregateType: "technical-match",
        eventId,
        eventType: "technical.command-accepted",
        eventVersion: 1,
        occurredAt: input.now,
        payload: { marker: input.marker },
        sequence,
      });
      if (input.failBeforeCommit) {
        throw new Error("FAIL_BEFORE_COMMIT");
      }
      return {
        eventId,
        marker: input.marker,
        matchId: input.matchId,
        sequence: Number(sequence),
      };
    },
    request: { marker: input.marker, matchId: input.matchId },
    scope: `technical-command:${input.matchId}`,
  });
}

function quoteDatabaseName(value: string): string {
  if (!/^[a-z0-9_]+$/u.test(value)) {
    throw new Error("Nome inseguro para banco temporário.");
  }
  return `"${value}"`;
}

function databaseUrl(value: string): string {
  const url = new URL(adminDatabaseUrl);
  url.pathname = `/${value}`;
  return url.toString();
}

function data(mode: "always-fail" | "fail-after-effect-once" | "succeed" | "timeout") {
  return {
    correlationId: createPublicId(),
    effectId: createPublicId(),
    mode,
    version: 1 as const,
  };
}

describe("worker queue and outbox foundations", () => {
  const adminPool = new Pool({
    application_name: "arquibancada-viva-queue-integration-admin",
    connectionString: adminDatabaseUrl,
    max: 1,
  });
  const logs: WorkerLog[] = [];
  let databaseRuntime: DatabaseRuntime;
  let migrationRuntime: DatabaseRuntime;
  let queueRuntime: TechnicalQueueRuntime;

  beforeAll(async () => {
    await adminPool.query(`CREATE DATABASE ${quoteDatabaseName(databaseName)}`);
    migrationRuntime = createMigrationDatabase(databaseUrl(databaseName));
    databaseRuntime = createDatabaseRuntime("worker", databaseUrl(databaseName), 5);
    await applyMigrations(migrationRuntime.database);
    queueRuntime = createTechnicalQueue({
      concurrency: 2,
      database: databaseRuntime.database,
      logger: (entry) => logs.push(entry),
      policy: {
        attempts: 3,
        backoffMs: 25,
        completedRetentionSeconds: 60,
        failedRetentionSeconds: 60,
        jobTimeoutMs: 50,
        retainedJobCount: 100,
      },
      prefix: queuePrefix,
      redisUrl,
    });
    await queueRuntime.start();
  });

  afterAll(async () => {
    if (queueRuntime) {
      await queueRuntime.queue.obliterate({ force: true }).catch(() => undefined);
      await queueRuntime.close();
    }
    await Promise.allSettled([databaseRuntime?.close(), migrationRuntime?.close()]);
    await adminPool.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [databaseName],
    );
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoteDatabaseName(databaseName)}`);
    await adminPool.end();
  });

  it("retries an idempotent job without duplicating its durable effect", async () => {
    const input = data("fail-after-effect-once");
    const job = await queueRuntime.enqueue(input);

    await expect(job.waitUntilFinished(queueRuntime.events, 5_000)).resolves.toEqual({
      applied: false,
    });
    expect(await countQueueFixtureEffects(databaseRuntime.database, input.effectId)).toBe(1);

    const storedJob = await queueRuntime.queue.getJob(job.id ?? "");
    expect(storedJob?.attemptsMade).toBe(2);
  });

  it("does not execute the processor effect for an invalid payload", async () => {
    const input = data("succeed");
    const unsafeQueue = queueRuntime.queue as unknown as Queue<unknown>;
    const job = await unsafeQueue.add(
      TECHNICAL_FIXTURE_JOB_NAME,
      { ...input, version: 2 },
      {
        jobId: `invalid-${input.effectId}`,
      },
    );

    await expect(job.waitUntilFinished(queueRuntime.events, 5_000)).rejects.toThrow(
      "INVALID_JOB_PAYLOAD",
    );
    expect(await countQueueFixtureEffects(databaseRuntime.database, input.effectId)).toBe(0);
  });

  it("retains and reports an exhausted job without retrying forever", async () => {
    const input = data("always-fail");
    const job = await queueRuntime.enqueue(input);

    await expect(job.waitUntilFinished(queueRuntime.events, 5_000)).rejects.toThrow(
      "TECHNICAL_FIXTURE_FAILURE",
    );
    const storedJob = await queueRuntime.queue.getJob(job.id ?? "");
    expect(await storedJob?.getState()).toBe("failed");
    expect(storedJob?.attemptsMade).toBe(3);
    await vi.waitFor(() => {
      expect(
        logs.filter((entry) => entry.event === "queue.job_exhausted" && entry.jobId === job.id),
      ).toHaveLength(1);
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    const unchangedJob = await queueRuntime.queue.getJob(job.id ?? "");
    expect(unchangedJob?.attemptsMade).toBe(3);
  });

  it("fails publication predictably while Redis is unavailable and creates no durable effect", async () => {
    const input = data("succeed");
    const unavailableProducer = createTechnicalQueueProducer({
      prefix: `${queuePrefix}-unavailable`,
      redisUrl: "redis://127.0.0.1:63998",
    });

    try {
      await expect(unavailableProducer.enqueue(input)).rejects.toBeInstanceOf(
        QueueUnavailableError,
      );
      expect(await countQueueFixtureEffects(databaseRuntime.database, input.effectId)).toBe(0);
    } finally {
      await unavailableProducer.close();
    }
  });

  it("returns one durable event and one coherent response for concurrent idempotent commands", async () => {
    const matchId = createPublicId();
    const idempotencyKey = createPublicId();
    const now = new Date("2026-09-15T03:00:00.000Z");
    let executions = 0;

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        executeFixtureCommand({
          database: databaseRuntime.database,
          idempotencyKey,
          marker: "concurrent",
          matchId,
          now,
          onExecute: () => {
            executions += 1;
          },
        }),
      ),
    );

    expect(executions).toBe(1);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    const firstValue = results[0]?.value;
    expect(firstValue).toBeDefined();
    expect(results.map((result) => result.value)).toEqual(
      Array.from({ length: 8 }, () => firstValue),
    );
    const eventId = firstValue?.eventId ?? "";
    expect((await getOutboxMessage(databaseRuntime.database, eventId))?.status).toBe("pending");
    const storedIdempotencyRecord = (
      await databaseRuntime.database.select().from(idempotencyRecords)
    )
      .filter((record) => record.scope === `technical-command:${matchId}`)
      .at(-1);
    expect(storedIdempotencyRecord?.keyHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(storedIdempotencyRecord?.keyHash).not.toContain(idempotencyKey);

    const dispatcher = createOutboxDispatcher(databaseRuntime.database, {
      clock: () => new Date("2026-09-15T03:00:01.000Z"),
      publisher: { publish: async () => undefined },
    });
    await expect(dispatcher.dispatchNow(eventId)).resolves.toBe("published");
  });

  it("rolls the idempotency record and event back together before commit", async () => {
    const eventId = createPublicId();
    const matchId = createPublicId();
    const idempotencyKey = createPublicId();
    const now = new Date("2026-09-15T03:01:00.000Z");

    await expect(
      executeFixtureCommand({
        database: databaseRuntime.database,
        eventId,
        failBeforeCommit: true,
        idempotencyKey,
        marker: "rollback",
        matchId,
        now,
      }),
    ).rejects.toThrow("FAIL_BEFORE_COMMIT");
    expect(await getOutboxMessage(databaseRuntime.database, eventId)).toBeUndefined();

    const retry = await executeFixtureCommand({
      database: databaseRuntime.database,
      idempotencyKey,
      marker: "rollback",
      matchId,
      now: new Date(now.getTime() + 1),
    });
    expect(retry.replayed).toBe(false);
    await createOutboxDispatcher(databaseRuntime.database, {
      clock: () => new Date(now.getTime() + 2),
      publisher: { publish: async () => undefined },
    }).dispatchNow(retry.value.eventId);
  });

  it("recovers a post-commit publication failure with the original event id", async () => {
    const now = new Date("2026-09-15T03:02:00.000Z");
    let currentTime = now;
    const command = await executeFixtureCommand({
      database: databaseRuntime.database,
      idempotencyKey: createPublicId(),
      marker: "redis-loss",
      matchId: createPublicId(),
      now,
    });
    const publishedEventIds: string[] = [];
    let unavailable = true;
    const dispatcher = createOutboxDispatcher(databaseRuntime.database, {
      clock: () => currentTime,
      leaseMs: 50,
      publisher: {
        async publish(message) {
          publishedEventIds.push(message.eventId);
          if (unavailable) {
            unavailable = false;
            throw new QueueUnavailableError();
          }
        },
      },
      retryBaseMs: 10,
      retryMaximumMs: 100,
    });

    await expect(dispatcher.dispatchNow(command.value.eventId)).resolves.toBe("deferred");
    expect(command.replayed).toBe(false);
    expect((await getOutboxMessage(databaseRuntime.database, command.value.eventId))?.status).toBe(
      "failed",
    );

    currentTime = new Date(now.getTime() + 11);
    const recovery = createOutboxRecovery({
      batchSize: 10,
      dispatcher,
      logger: (entry) => logs.push(entry),
    });
    await expect(recovery.runOnce()).resolves.toMatchObject({ published: 1 });
    await recovery.close();

    expect(publishedEventIds).toEqual([command.value.eventId, command.value.eventId]);
    expect((await getOutboxMessage(databaseRuntime.database, command.value.eventId))?.status).toBe(
      "published",
    );
  });

  it("rejects reuse of an idempotency key with a different request", async () => {
    const matchId = createPublicId();
    const idempotencyKey = createPublicId();
    const now = new Date("2026-09-15T03:03:00.000Z");
    const first = await executeFixtureCommand({
      database: databaseRuntime.database,
      idempotencyKey,
      marker: "first",
      matchId,
      now,
    });

    await expect(
      executeFixtureCommand({
        database: databaseRuntime.database,
        idempotencyKey,
        marker: "different",
        matchId,
        now,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    await createOutboxDispatcher(databaseRuntime.database, {
      clock: () => new Date(now.getTime() + 1),
      publisher: { publish: async () => undefined },
    }).dispatchNow(first.value.eventId);
  });

  it("only permits key reuse after the expired record is explicitly cleaned", async () => {
    const now = new Date("2026-09-15T03:04:00.000Z");
    const key = createPublicId();
    const scope = "technical-expiry";
    const first = await executeIdempotentCommand(databaseRuntime.database, {
      expiresAt: new Date(now.getTime() + 10),
      key,
      now,
      operation: async () => ({ marker: "first" }),
      request: { marker: "first" },
      scope,
    });
    expect(first.replayed).toBe(false);

    expect(
      await deleteExpiredIdempotencyRecords(databaseRuntime.database, {
        before: new Date(now.getTime() + 11),
      }),
    ).toBe(1);
    await expect(
      executeIdempotentCommand(databaseRuntime.database, {
        key,
        now: new Date(now.getTime() + 12),
        operation: async () => ({ marker: "second" }),
        request: { marker: "second" },
        scope,
      }),
    ).resolves.toMatchObject({ replayed: false, value: { marker: "second" } });
  });
});
