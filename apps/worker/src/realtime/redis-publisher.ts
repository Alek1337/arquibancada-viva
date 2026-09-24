import {
  matchRealtimeEventSchema,
  REALTIME_EVENT_CHANNEL,
  REALTIME_EVENT_VERSION,
} from "@arquibancada-viva/contracts";
import type { OutboxPublisher } from "@arquibancada-viva/database";
import Redis from "ioredis";
import { noopObservability, type Observability } from "@arquibancada-viva/observability";

export interface RealtimeRedisPublisher extends OutboxPublisher {
  checkConnection(): Promise<void>;
  close(): Promise<void>;
  start(): Promise<void>;
}

export function createRealtimeRedisPublisher(
  redisUrl: string,
  observability: Observability = noopObservability,
): RealtimeRedisPublisher {
  const client = new Redis(redisUrl, {
    connectTimeout: 1_000,
    connectionName: "worker-realtime-publisher",
    enableOfflineQueue: true,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) => Math.min(attempt * 100, 2_000),
  });
  client.on("error", () => undefined);
  let closePromise: Promise<void> | undefined;
  let startPromise: Promise<void> | undefined;

  return {
    async checkConnection() {
      await client.ping();
    },
    close() {
      if (!closePromise) {
        closePromise = (async () => {
          if (client.status === "ready") {
            await client.quit();
          } else if (client.status !== "end") {
            client.disconnect();
          }
        })();
      }
      return closePromise;
    },
    async publish(message) {
      if (message.aggregateType !== "match") {
        throw new Error("UNSUPPORTED_REALTIME_AGGREGATE");
      }
      const event = matchRealtimeEventSchema.parse({
        eventId: message.eventId,
        eventType: message.eventType,
        matchId: message.aggregateId,
        occurredAt: message.occurredAt.toISOString(),
        payload: message.payload,
        sequence: Number(message.sequence),
        version: REALTIME_EVENT_VERSION,
      });
      const subscribers = await observability.withSpan(
        "outbox.publish",
        {
          ...(message.correlationId ? { correlationId: message.correlationId } : {}),
          eventId: message.eventId,
          matchId: message.aggregateId,
          sequence: Number(message.sequence),
        },
        () => client.publish(REALTIME_EVENT_CHANNEL, JSON.stringify(event)),
      );
      if (subscribers < 1) {
        throw new Error("REALTIME_SUBSCRIBER_UNAVAILABLE");
      }
      observability.recordOutboxDelay(Date.now() - message.occurredAt.getTime(), {
        ...(message.correlationId ? { correlationId: message.correlationId } : {}),
        eventId: message.eventId,
        matchId: message.aggregateId,
        sequence: Number(message.sequence),
      });
    },
    start() {
      if (!startPromise) {
        startPromise = client.connect().then(() => undefined);
      }
      return startPromise;
    },
  };
}
