import { parseApiConfig } from "@arquibancada-viva/config/api";
import { describe, expect, it, vi } from "vitest";
import { createApiApplication, type ApiDependencies } from "./main.js";

const validEnvironment = {
  API_HOST: "127.0.0.1",
  API_PORT: "3101",
  AUTH_BASE_URL: "http://127.0.0.1:3101",
  AUTH_SECRET: "test-only-secret-with-32-characters",
  DATABASE_URL: "postgresql://app:app@127.0.0.1:5432/test",
  LOG_LEVEL: "fatal",
  NODE_ENV: "test",
  REDIS_URL: "redis://127.0.0.1:6379",
  S3_ACCESS_KEY_ID: "test-access",
  S3_BUCKET: "test-bucket",
  S3_ENDPOINT: "http://127.0.0.1:9000",
  S3_REGION: "us-east-1",
  S3_SECRET_ACCESS_KEY: "test-only-storage-secret-32-characters",
  WEB_ORIGIN: "http://127.0.0.1:3100",
} as const;

async function createTestApplication(dependencies: ApiDependencies) {
  const application = await createApiApplication(parseApiConfig(validEnvironment), {
    dependencies,
    enableShutdownHooks: false,
    logger: false,
  });
  await application.init();
  return application;
}

describe("API operational probes", () => {
  it("keeps liveness up and reports readiness when dependencies respond", async () => {
    const close = vi.fn(async () => undefined);
    const application = await createTestApplication({
      checkReadiness: async () => undefined,
      close,
    });

    const server = application.getHttpAdapter().getInstance();
    const health = await server.inject({ method: "GET", url: "/v1/health" });
    const readiness = await server.inject({ method: "GET", url: "/v1/ready" });

    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ service: "api", status: "ok" });
    expect(readiness.statusCode).toBe(200);
    expect(readiness.json()).toEqual({
      checks: { postgres: "up" },
      service: "api",
      status: "ready",
    });

    await application.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it("returns 503 readiness without taking liveness down", async () => {
    const application = await createTestApplication({
      checkReadiness: async () => {
        throw new Error("database unavailable");
      },
      close: async () => undefined,
    });

    const server = application.getHttpAdapter().getInstance();
    const readiness = await server.inject({ method: "GET", url: "/v1/ready" });
    const health = await server.inject({ method: "GET", url: "/v1/health" });

    expect(readiness.statusCode).toBe(503);
    expect(readiness.json()).toMatchObject({
      checks: { postgres: "down" },
      service: "api",
      status: "not_ready",
    });
    expect(health.statusCode).toBe(200);

    await application.close();
  });
});
