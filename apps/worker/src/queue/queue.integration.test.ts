import { TECHNICAL_FIXTURE_JOB_NAME } from "@arquibancada-viva/contracts";
import {
  applyMigrations,
  countQueueFixtureEffects,
  createDatabaseRuntime,
  createMigrationDatabase,
  createPublicId,
  type DatabaseRuntime,
} from "@arquibancada-viva/database";
import type { Queue } from "bullmq";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkerLog } from "../logger.js";
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

describe("BullMQ foundation", () => {
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
});
