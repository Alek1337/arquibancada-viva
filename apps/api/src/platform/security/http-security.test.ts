import { parseApiConfig } from "@arquibancada-viva/config/api";
import { problemDetailsSchema } from "@arquibancada-viva/contracts";
import Fastify from "fastify";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createApiLoggerOptions } from "../logger.js";
import { mountHttpSecurity } from "./http-security.js";
import {
  createRateLimitGuard,
  type RateLimitCounterStore,
  type RateLimitGuard,
} from "./rate-limit.js";

const config = parseApiConfig({
  API_BODY_LIMIT_BYTES: "1024",
  API_HOST: "127.0.0.1",
  API_PORT: "3101",
  AUTH_BASE_URL: "https://api.example.test",
  AUTH_SECRET: "test-only-secret-with-32-characters",
  DATABASE_URL: "postgresql://app:app@127.0.0.1:5432/test",
  LOG_LEVEL: "info",
  NODE_ENV: "production",
  RATE_LIMIT_AUTH_MAX: "3",
  RATE_LIMIT_GENERAL_MAX: "10",
  RATE_LIMIT_MUTATION_MAX: "5",
  RATE_LIMIT_WINDOW_MS: "60000",
  REDIS_URL: "redis://127.0.0.1:6379",
  S3_ACCESS_KEY_ID: "test-access-key",
  S3_BUCKET: "test-bucket",
  S3_ENDPOINT: "http://127.0.0.1:9000",
  S3_REGION: "us-east-1",
  S3_SECRET_ACCESS_KEY: "test-only-storage-secret-32-characters",
  WEB_ORIGIN: "https://web.example.test",
});
const correlationId = "0199a7c0-4457-7b37-b043-00f18cab1234";

describe("HTTP security baseline", () => {
  const instances: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(instances.splice(0).map((instance) => instance.close()));
  });

  function create(rateLimit?: RateLimitGuard, stream?: Writable) {
    const fastify = Fastify({
      bodyLimit: config.API_BODY_LIMIT_BYTES,
      genReqId: () => correlationId,
      logger: stream ? createApiLoggerOptions("info", stream) : false,
      requestIdHeader: false,
      trustProxy: false,
    });
    instances.push(fastify);
    mountHttpSecurity(fastify, config, rateLimit);
    return fastify;
  }

  it("sets security headers and rejects an untrusted origin", async () => {
    const fastify = create();
    fastify.get("/fixture", async () => ({ ok: true }));

    const allowed = await fastify.inject({
      headers: { origin: config.WEB_ORIGIN },
      method: "GET",
      url: "/fixture",
    });
    const denied = await fastify.inject({
      headers: { origin: "https://evil.example.test" },
      method: "GET",
      url: "/fixture",
    });

    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers["x-content-type-options"]).toBe("nosniff");
    expect(allowed.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(allowed.headers["strict-transport-security"]).toContain("max-age=31536000");
    expect(allowed.headers["x-correlation-id"]).toBe(correlationId);
    expect(denied.statusCode).toBe(403);
    expect(problemDetailsSchema.parse(denied.json())).toMatchObject({
      code: "FORBIDDEN",
      correlationId,
    });
  });

  it("rejects oversized payloads and never returns or logs stack secrets", async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const fastify = create(undefined, stream);
    fastify.post("/payload", async () => ({ ok: true }));
    fastify.get("/failure", async () => {
      throw new Error("must-not-appear-error-secret");
    });

    const oversized = await fastify.inject({
      headers: { "content-type": "application/json" },
      method: "POST",
      payload: { value: "x".repeat(2_000) },
      url: "/payload",
    });
    fastify.log.info({
      S3_SECRET_ACCESS_KEY: "must-not-appear-storage-secret",
      signedUrl: "https://storage.test/object?X-Amz-Signature=must-not-appear-signature",
    });
    const failure = await fastify.inject({ method: "GET", url: "/failure" });
    const output = chunks.join("");

    expect(oversized.statusCode).toBe(413);
    expect(problemDetailsSchema.parse(oversized.json()).code).toBe("VALIDATION_ERROR");
    expect(failure.statusCode).toBe(500);
    expect(problemDetailsSchema.parse(failure.json())).toMatchObject({
      code: "INTERNAL_ERROR",
      correlationId,
    });
    expect(failure.body).not.toContain("stack");
    expect(failure.body).not.toContain("must-not-appear");
    expect(output).not.toContain("must-not-appear");
  });

  it("uses one atomic counter scope under concurrent requests", async () => {
    const counters = new Map<string, number>();
    const observedKeys: string[] = [];
    const store: RateLimitCounterStore = {
      async increment(key, windowMs) {
        await Promise.resolve();
        observedKeys.push(key);
        const count = (counters.get(key) ?? 0) + 1;
        counters.set(key, count);
        return { count, ttlMs: windowMs };
      },
    };
    const fastify = create(createRateLimitGuard(store, config.RATE_LIMIT_WINDOW_MS));
    fastify.post("/v1/auth/fixture", async () => ({ ok: true }));

    const responses = await Promise.all(
      Array.from({ length: 12 }, () => fastify.inject({ method: "POST", url: "/v1/auth/fixture" })),
    );

    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(3);
    expect(responses.filter((response) => response.statusCode === 429)).toHaveLength(9);
    expect(new Set(observedKeys)).toHaveLength(1);
    expect(observedKeys[0]).not.toContain("127.0.0.1");
  });

  it("fails closed for mutations and open for reads when rate-limit Redis is unavailable", async () => {
    const unavailable: RateLimitGuard = {
      async consume() {
        throw new Error("redis unavailable");
      },
    };
    const fastify = create(unavailable);
    fastify.get("/v1/fixture", async () => ({ ok: true }));
    fastify.post("/v1/fixture", async () => ({ ok: true }));

    const [read, mutation] = await Promise.all([
      fastify.inject({ method: "GET", url: "/v1/fixture" }),
      fastify.inject({ method: "POST", url: "/v1/fixture" }),
    ]);

    expect(read.statusCode).toBe(200);
    expect(mutation.statusCode).toBe(503);
    expect(mutation.headers["retry-after"]).toBe("1");
  });
});
