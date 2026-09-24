import {
  TECHNICAL_FIXTURE_JOB_NAME,
  technicalFixtureJobDataSchema,
  technicalFixtureJobId,
  type TechnicalFixtureJobData,
} from "@arquibancada-viva/contracts";
import { applyQueueFixtureEffect, type Database } from "@arquibancada-viva/database";
import { Queue, QueueEvents, UnrecoverableError, Worker, type Job, type JobsOptions } from "bullmq";
import Redis from "ioredis";
import type { WorkerLogger } from "../logger.js";
import { noopObservability, type Observability } from "@arquibancada-viva/observability";
import { QueueUnavailableError } from "./errors.js";
import { createTechnicalFixtureProcessor, type TechnicalFixtureJobResult } from "./processor.js";

export const TECHNICAL_QUEUE_NAME = "technical-v1";

export interface TechnicalQueuePolicy {
  readonly attempts: number;
  readonly backoffMs: number;
  readonly completedRetentionSeconds: number;
  readonly failedRetentionSeconds: number;
  readonly jobTimeoutMs: number;
  readonly retainedJobCount: number;
}

export const DEFAULT_TECHNICAL_QUEUE_POLICY: TechnicalQueuePolicy = {
  attempts: 3,
  backoffMs: 1_000,
  completedRetentionSeconds: 3_600,
  failedRetentionSeconds: 604_800,
  jobTimeoutMs: 2_000,
  retainedJobCount: 1_000,
};

export interface TechnicalQueueOptions {
  readonly concurrency: number;
  readonly database: Database;
  readonly logger: WorkerLogger;
  readonly observability?: Observability;
  readonly policy?: TechnicalQueuePolicy;
  readonly prefix?: string;
  readonly redisUrl: string;
}

export interface TechnicalQueueRuntime {
  readonly events: QueueEvents<TechnicalFixtureJobResult>;
  readonly queue: Queue<
    TechnicalFixtureJobData,
    TechnicalFixtureJobResult,
    typeof TECHNICAL_FIXTURE_JOB_NAME
  >;
  checkConnection(): Promise<void>;
  close(): Promise<void>;
  enqueue(data: TechnicalFixtureJobData): Promise<Job<TechnicalFixtureJobData>>;
  start(): Promise<void>;
}

export interface TechnicalQueueProducer {
  close(): Promise<void>;
  enqueue(data: TechnicalFixtureJobData): Promise<Job<TechnicalFixtureJobData>>;
}

function createRedisClient(redisUrl: string, connectionName: string, failFast: boolean): Redis {
  const client = new Redis(redisUrl, {
    connectTimeout: 1_000,
    connectionName,
    enableOfflineQueue: true,
    lazyConnect: true,
    maxRetriesPerRequest: failFast ? 1 : null,
    retryStrategy: (attempt) => Math.min(attempt * 100, 2_000),
  });
  client.on("error", () => undefined);
  return client;
}

function defaultJobOptions(policy: TechnicalQueuePolicy): JobsOptions {
  return {
    attempts: policy.attempts,
    backoff: { delay: policy.backoffMs, type: "exponential" },
    keepLogs: 20,
    removeOnComplete: {
      age: policy.completedRetentionSeconds,
      count: policy.retainedJobCount,
    },
    removeOnFail: {
      age: policy.failedRetentionSeconds,
      count: policy.retainedJobCount,
    },
    sizeLimit: 16 * 1_024,
  };
}

function createProducerComponents(
  redisUrl: string,
  prefix: string,
  policy: TechnicalQueuePolicy,
): {
  readonly connection: Redis;
  readonly queue: Queue<
    TechnicalFixtureJobData,
    TechnicalFixtureJobResult,
    typeof TECHNICAL_FIXTURE_JOB_NAME
  >;
} {
  const connection = createRedisClient(redisUrl, "worker-queue-producer", true);
  const queue = new Queue<
    TechnicalFixtureJobData,
    TechnicalFixtureJobResult,
    typeof TECHNICAL_FIXTURE_JOB_NAME
  >(TECHNICAL_QUEUE_NAME, {
    connection,
    defaultJobOptions: defaultJobOptions(policy),
    prefix,
    skipWaitingForReady: true,
    streams: { events: { maxLen: 5_000 } },
  });
  return { connection, queue };
}

async function enqueue(
  queue: Queue<TechnicalFixtureJobData, TechnicalFixtureJobResult>,
  data: TechnicalFixtureJobData,
): Promise<Job<TechnicalFixtureJobData>> {
  const validData = technicalFixtureJobDataSchema.parse(data);
  try {
    return await queue.add(TECHNICAL_FIXTURE_JOB_NAME, validData, {
      jobId: technicalFixtureJobId(validData.effectId),
    });
  } catch {
    throw new QueueUnavailableError();
  }
}

async function disconnect(client: Redis): Promise<void> {
  if (client.status === "end") {
    return;
  }
  if (client.status === "ready") {
    await client.quit();
    return;
  }
  client.disconnect();
}

export function createTechnicalQueue(options: TechnicalQueueOptions): TechnicalQueueRuntime {
  const policy = options.policy ?? DEFAULT_TECHNICAL_QUEUE_POLICY;
  const prefix = options.prefix ?? "arquibancada-viva";
  const producer = createProducerComponents(options.redisUrl, prefix, policy);
  const producerConnection = producer.connection;
  const workerConnection = createRedisClient(options.redisUrl, "worker-queue-consumer", false);
  const eventsConnection = createRedisClient(options.redisUrl, "worker-queue-events", false);
  const exhaustedJobs = new Set<string>();
  let closePromise: Promise<void> | undefined;
  let startPromise: Promise<void> | undefined;

  const queue = producer.queue;
  const events = new QueueEvents<TechnicalFixtureJobResult>(TECHNICAL_QUEUE_NAME, {
    connection: eventsConnection,
    prefix,
  });
  const observability = options.observability ?? noopObservability;
  const fixtureProcessor = createTechnicalFixtureProcessor(
    {
      apply: (data) =>
        applyQueueFixtureEffect(options.database, {
          correlationId: data.correlationId,
          effectId: data.effectId,
          jobId: data.jobId,
          jobName: TECHNICAL_FIXTURE_JOB_NAME,
          jobVersion: data.version,
        }),
    },
    policy.jobTimeoutMs,
  );
  const processor: typeof fixtureProcessor = async (job, token, signal) => {
    const parsed = technicalFixtureJobDataSchema.safeParse(job.data);
    const context = {
      attempt: job.attemptsMade + 1,
      jobName: job.name,
      ...(job.id ? { jobId: job.id } : {}),
      ...(parsed.success ? { correlationId: parsed.data.correlationId } : {}),
    };
    return observability.withSpan("worker.job", context, () =>
      fixtureProcessor(job, token, signal),
    );
  };
  const worker = new Worker<unknown, TechnicalFixtureJobResult, typeof TECHNICAL_FIXTURE_JOB_NAME>(
    TECHNICAL_QUEUE_NAME,
    processor,
    {
      autorun: false,
      concurrency: options.concurrency,
      connection: workerConnection,
      maxStartedAttempts: policy.attempts + 1,
      prefix,
    },
  );

  worker.on("error", () => {
    options.logger({
      errorCode: "QUEUE_WORKER_ERROR",
      event: "queue.worker_error",
      level: "error",
    });
  });
  events.on("error", () => {
    options.logger({
      errorCode: "QUEUE_EVENTS_ERROR",
      event: "queue.events_error",
      level: "error",
    });
  });
  worker.on("failed", (job, error) => {
    if (!job?.id) {
      return;
    }
    const attempts = job.opts.attempts ?? 1;
    const exhausted = error instanceof UnrecoverableError || job.attemptsMade >= attempts;
    if (!exhausted || exhaustedJobs.has(job.id)) {
      return;
    }
    exhaustedJobs.add(job.id);
    const parsed = technicalFixtureJobDataSchema.safeParse(job.data);
    observability.recordJob("failed", {
      attempt: job.attemptsMade,
      ...(parsed.success ? { correlationId: parsed.data.correlationId } : {}),
      jobName: job.name,
      ...(job.id ? { jobId: job.id } : {}),
    });
    options.logger({
      attempt: job.attemptsMade,
      ...(parsed.success ? { correlationId: parsed.data.correlationId } : {}),
      errorCode: error.message,
      event: "queue.job_exhausted",
      jobId: job.id,
      jobName: job.name,
      level: "error",
    });
  });
  worker.on("completed", (job) => {
    const parsed = technicalFixtureJobDataSchema.safeParse(job.data);
    observability.recordJob("completed", {
      attempt: job.attemptsMade,
      ...(parsed.success ? { correlationId: parsed.data.correlationId } : {}),
      jobName: job.name,
      ...(job.id ? { jobId: job.id } : {}),
    });
  });

  return {
    events,
    queue,
    async checkConnection() {
      try {
        await producerConnection.ping();
      } catch {
        throw new QueueUnavailableError();
      }
    },
    close() {
      if (closePromise) {
        return closePromise;
      }
      closePromise = (async () => {
        await worker.close();
        await events.close();
        await queue.close();
        await Promise.all([
          disconnect(producerConnection),
          disconnect(workerConnection),
          disconnect(eventsConnection),
        ]);
      })();
      return closePromise;
    },
    async enqueue(data) {
      return enqueue(queue, data);
    },
    start() {
      if (!startPromise) {
        startPromise = (async () => {
          await Promise.all([
            queue.waitUntilReady(),
            events.waitUntilReady(),
            worker.waitUntilReady(),
          ]);
          void worker.run().catch(() => {
            options.logger({
              errorCode: "QUEUE_WORKER_STOPPED",
              event: "queue.worker_stopped",
              level: "error",
            });
          });
        })();
      }
      return startPromise;
    },
  };
}

export function createTechnicalQueueProducer(options: {
  readonly policy?: TechnicalQueuePolicy;
  readonly prefix?: string;
  readonly redisUrl: string;
}): TechnicalQueueProducer {
  const policy = options.policy ?? DEFAULT_TECHNICAL_QUEUE_POLICY;
  const producer = createProducerComponents(
    options.redisUrl,
    options.prefix ?? "arquibancada-viva",
    policy,
  );
  let closePromise: Promise<void> | undefined;

  return {
    close() {
      if (!closePromise) {
        closePromise = producer.queue.close().then(() => disconnect(producer.connection));
      }
      return closePromise;
    },
    enqueue: (data) => enqueue(producer.queue, data),
  };
}
