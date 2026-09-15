import type { AuthRuntime } from "@arquibancada-viva/auth";
import { parseApiConfig } from "@arquibancada-viva/config/api";
import Fastify from "fastify";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createApiLoggerOptions } from "../logger.js";
import { mountAuthFastify } from "./fastify-adapter.js";

const config = parseApiConfig({
  API_HOST: "127.0.0.1",
  API_PORT: "3101",
  AUTH_BASE_URL: "https://api.example.test",
  AUTH_SECRET: "test-only-secret-with-32-characters",
  DATABASE_URL: "postgresql://app:app@127.0.0.1:5432/test",
  LOG_LEVEL: "info",
  REDIS_URL: "redis://127.0.0.1:6379",
  S3_ACCESS_KEY_ID: "test-access-key",
  S3_BUCKET: "test-bucket",
  S3_ENDPOINT: "http://127.0.0.1:9000",
  S3_REGION: "us-east-1",
  S3_SECRET_ACCESS_KEY: "test-only-storage-secret-32-characters",
  WEB_ORIGIN: "https://web.example.test",
});

describe("Fastify auth logging", () => {
  it("does not log secrets from a failed auth request", async () => {
    const sentinels = {
      authorization: "Bearer sentinel-authorization",
      cookie: "session=sentinel-cookie",
      password: "sentinel-password",
      queryToken: "sentinel-query-token",
    };
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const auth: AuthRuntime = {
      async handle() {
        throw new Error(`Authentication failed for ${sentinels.authorization}`);
      },
      async resolveIdentity() {
        return null;
      },
    };
    const fastify = Fastify({ logger: createApiLoggerOptions("info", stream) });
    mountAuthFastify(fastify, auth, config);

    try {
      const response = await fastify.inject({
        headers: {
          authorization: sentinels.authorization,
          cookie: sentinels.cookie,
          origin: config.WEB_ORIGIN,
        },
        method: "POST",
        payload: { password: sentinels.password },
        url: `/v1/auth/sign-in/email?token=${sentinels.queryToken}`,
      });
      const output = chunks.join("");

      expect(response.statusCode).toBe(500);
      expect(output).toContain("auth.request_failed");
      for (const sentinel of Object.values(sentinels)) {
        expect(output).not.toContain(sentinel);
      }
    } finally {
      await fastify.close();
    }
  });
});
