import { REALTIME_EVENT_CHANNEL, matchRealtimeEventSchema } from "@arquibancada-viva/contracts";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import type { Server } from "socket.io";

export interface RealtimeRedisRuntime {
  checkConnection(): Promise<void>;
  close(): Promise<void>;
  start(): Promise<void>;
}

interface RuntimeLogger {
  error?(details: unknown, message?: string): void;
  warn?(details: unknown, message?: string): void;
}

const STARTUP_GRACE_MS = 1_500;

export function createRealtimeRedisRuntime(
  io: Server,
  redisUrl: string,
  onEvent: (event: ReturnType<typeof matchRealtimeEventSchema.parse>) => void,
  logger?: RuntimeLogger,
): RealtimeRedisRuntime {
  const commonOptions = {
    connectTimeout: 1_000,
    enableOfflineQueue: true,
    lazyConnect: true,
    retryStrategy: (attempt: number) => Math.min(attempt * 100, 2_000),
  } as const;
  const publisher = new Redis(redisUrl, {
    ...commonOptions,
    connectionName: "api-socket-adapter-publisher",
    maxRetriesPerRequest: 1,
  });
  const adapterSubscriber = new Redis(redisUrl, {
    ...commonOptions,
    connectionName: "api-socket-adapter-subscriber",
    maxRetriesPerRequest: null,
  });
  const eventSubscriber = new Redis(redisUrl, {
    ...commonOptions,
    connectionName: "api-realtime-event-subscriber",
    maxRetriesPerRequest: null,
  });
  const clients = [publisher, adapterSubscriber, eventSubscriber] as const;
  let adapterAttached = false;
  let subscribed = false;
  let activation: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  let closing = false;

  for (const client of clients) {
    client.on("error", (error) => {
      if (!closing) {
        logger?.warn?.(
          { code: (error as NodeJS.ErrnoException).code ?? "REDIS_ERROR" },
          "realtime.redis_error",
        );
      }
    });
  }

  eventSubscriber.on("message", (channel, rawMessage) => {
    if (channel !== REALTIME_EVENT_CHANNEL) {
      return;
    }
    try {
      onEvent(matchRealtimeEventSchema.parse(JSON.parse(rawMessage)));
    } catch (error) {
      logger?.error?.(
        { error: error instanceof Error ? error.message : "unknown" },
        "realtime.invalid_event",
      );
    }
  });

  async function activate(): Promise<void> {
    if (closing || clients.some((client) => client.status !== "ready")) {
      return;
    }
    activation ??= (async () => {
      if (!adapterAttached) {
        io.adapter(createAdapter(publisher, adapterSubscriber));
        adapterAttached = true;
      }
      if (!subscribed) {
        await eventSubscriber.subscribe(REALTIME_EVENT_CHANNEL);
        subscribed = true;
      }
    })().finally(() => {
      activation = undefined;
    });
    await activation;
  }

  for (const client of clients) {
    client.on("ready", () => {
      void activate().catch(() => {
        logger?.warn?.({ code: "ACTIVATION_FAILED" }, "realtime.redis_error");
      });
    });
  }

  return {
    async checkConnection() {
      if (!adapterAttached || !subscribed) {
        throw new Error("Redis realtime indisponível.");
      }
      await publisher.ping();
      await adapterSubscriber.ping();
      await eventSubscriber.ping();
    },
    close() {
      closePromise ??= (async () => {
        closing = true;
        if (subscribed && eventSubscriber.status === "ready") {
          await eventSubscriber.unsubscribe(REALTIME_EVENT_CHANNEL);
        }
        await Promise.allSettled(
          clients.map(async (client) => {
            if (client.status === "ready") {
              await client.quit();
            } else if (client.status !== "end") {
              client.disconnect();
            }
          }),
        );
      })();
      return closePromise;
    },
    async start() {
      const connections = Promise.allSettled(clients.map((client) => client.connect()));
      await Promise.race([
        connections,
        new Promise<void>((resolve) => setTimeout(resolve, STARTUP_GRACE_MS)),
      ]);
      try {
        await activate();
      } catch {
        logger?.warn?.({ code: "ACTIVATION_FAILED" }, "realtime.redis_error");
      }
    },
  };
}
