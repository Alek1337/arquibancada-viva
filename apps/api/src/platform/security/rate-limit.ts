import type { ApiConfig } from "@arquibancada-viva/config/api";
import { createHash } from "node:crypto";
import Redis from "ioredis";

const RATE_LIMIT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return { current, ttl }
`;

export interface RateLimitCounterStore {
  increment(
    key: string,
    windowMs: number,
  ): Promise<{ readonly count: number; readonly ttlMs: number }>;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

export interface RateLimitGuard {
  consume(input: {
    readonly identity: string;
    readonly limit: number;
    readonly scope: string;
  }): Promise<RateLimitDecision>;
}

export interface RedisRateLimitRuntime {
  readonly guard: RateLimitGuard;
  checkConnection(): Promise<void>;
  close(): Promise<void>;
  start(): Promise<void>;
}

export function createRateLimitGuard(
  store: RateLimitCounterStore,
  windowMs: number,
): RateLimitGuard {
  return {
    async consume(input) {
      const identityHash = createHash("sha256").update(input.identity).digest("hex");
      const key = `arquibancada-viva:rate-limit:v1:${input.scope}:${identityHash}`;
      const result = await store.increment(key, windowMs);
      return {
        allowed: result.count <= input.limit,
        limit: input.limit,
        remaining: Math.max(0, input.limit - result.count),
        retryAfterSeconds: Math.max(1, Math.ceil(result.ttlMs / 1_000)),
      };
    },
  };
}

export function createRedisRateLimitRuntime(config: ApiConfig): RedisRateLimitRuntime {
  const client = new Redis(config.REDIS_URL, {
    connectTimeout: 1_000,
    connectionName: "api-rate-limit",
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) => Math.min(attempt * 100, 2_000),
  });
  client.on("error", () => undefined);
  let closePromise: Promise<void> | undefined;
  let startPromise: Promise<void> | undefined;

  const store: RateLimitCounterStore = {
    async increment(key, windowMs) {
      if (client.status !== "ready") {
        throw new Error("RATE_LIMIT_REDIS_UNAVAILABLE");
      }
      const result = await client.eval(RATE_LIMIT_SCRIPT, 1, key, windowMs.toString());
      if (
        !Array.isArray(result) ||
        result.length !== 2 ||
        result.some((value) => typeof value !== "number")
      ) {
        throw new Error("INVALID_RATE_LIMIT_RESULT");
      }
      return { count: result[0] as number, ttlMs: result[1] as number };
    },
  };

  return {
    async checkConnection() {
      await client.ping();
    },
    close() {
      closePromise ??= (async () => {
        if (client.status === "ready") {
          await client.quit();
        } else if (client.status !== "end") {
          client.disconnect();
        }
      })();
      return closePromise;
    },
    guard: createRateLimitGuard(store, config.RATE_LIMIT_WINDOW_MS),
    start() {
      startPromise ??= client.connect().then(() => undefined);
      return startPromise;
    },
  };
}
