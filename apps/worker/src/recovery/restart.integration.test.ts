import { parseWorkerConfig } from "@arquibancada-viva/config/worker";
import { REALTIME_EVENT_CHANNEL } from "@arquibancada-viva/contracts";
import {
  createPublicId,
  executeTechnicalAction,
  getOutboxMessage,
} from "@arquibancada-viva/database";
import {
  createEphemeralPostgresDatabase,
  type EphemeralPostgresDatabase,
  waitFor,
} from "@arquibancada-viva/testing";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorkerDependencies, type WorkerDependencies } from "../dependencies.js";

const adminDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://app:app@127.0.0.1:5432/arquibancada_viva";
const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

describe("worker restart recovery", () => {
  let database: EphemeralPostgresDatabase;
  let runtime: WorkerDependencies | undefined;
  const subscriber = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  const received = new Set<string>();
  const workerLogs: unknown[] = [];

  async function waitForPublished(eventId: string): Promise<void> {
    try {
      await waitFor(() => received.has(eventId), { timeoutMs: 10_000 });
    } catch {
      const message = await getOutboxMessage(database.database, eventId);
      throw new Error(
        `WORKER_RECOVERY_TIMEOUT ${JSON.stringify({ logs: workerLogs, message }, (_key, value) =>
          typeof value === "bigint" ? value.toString() : value,
        )}`,
      );
    }
  }

  beforeAll(async () => {
    database = await createEphemeralPostgresDatabase({
      adminDatabaseUrl,
      prefix: "av_tft016_worker",
    });
    subscriber.on("message", (_channel, message) => {
      const event = JSON.parse(message) as { readonly eventId?: string };
      if (event.eventId) {
        received.add(event.eventId);
      }
    });
    await subscriber.connect();
    await subscriber.subscribe(REALTIME_EVENT_CHANNEL);
  }, 20_000);

  afterAll(async () => {
    await Promise.allSettled([runtime?.close(), subscriber.quit()]);
    await database?.close();
  });

  it("publishes pending committed actions before and after a worker restart", async () => {
    const inspector = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await inspector.connect();
    const subscriberCount = await inspector.pubsub("NUMSUB", REALTIME_EVENT_CHANNEL);
    await inspector.quit();
    expect(subscriberCount[0]).toBe(REALTIME_EVENT_CHANNEL);
    expect(Number(subscriberCount[1])).toBeGreaterThanOrEqual(1);

    const matchId = createPublicId();
    const first = await executeTechnicalAction({
      action: "battery",
      database: database.database,
      idempotencyKey: `worker-first-${createPublicId()}`,
      matchId,
      userId: "worker-recovery-fixture",
    });
    const config = parseWorkerConfig({
      DATABASE_URL: database.url,
      LOG_LEVEL: "warn",
      NODE_ENV: "test",
      REDIS_URL: redisUrl,
      S3_ACCESS_KEY_ID: "local-development",
      S3_BUCKET: "arquibancada-viva-local",
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_FORCE_PATH_STYLE: "true",
      S3_REGION: "us-east-1",
      S3_SECRET_ACCESS_KEY: "change-me-development-only-32-characters",
      WORKER_CONCURRENCY: "2",
      WORKER_DATABASE_POOL_MAX: "3",
      WORKER_PROBE_HOST: "127.0.0.1",
      WORKER_PROBE_PORT: "3002",
    });

    runtime = createWorkerDependencies(config, (entry) => workerLogs.push(entry));
    await runtime.start();
    await waitForPublished(first.value.eventId);
    await runtime.close();
    runtime = undefined;

    const second = await executeTechnicalAction({
      action: "mosaic",
      database: database.database,
      idempotencyKey: `worker-second-${createPublicId()}`,
      matchId,
      userId: "worker-recovery-fixture",
    });
    runtime = createWorkerDependencies(config, (entry) => workerLogs.push(entry));
    await runtime.start();
    await waitForPublished(second.value.eventId);

    expect(received.has(first.value.eventId)).toBe(true);
    expect(received.has(second.value.eventId)).toBe(true);
  }, 20_000);
});
