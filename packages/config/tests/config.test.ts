import { describe, expect, it } from "vitest";
import { parseApiConfig } from "../src/api.js";
import { parseClientConfig } from "../src/client.js";
import { parseWorkerConfig } from "../src/worker.js";

const storageConfig = {
  S3_ENDPOINT: "http://localhost:9000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "arquibancada-viva-local",
  S3_ACCESS_KEY_ID: "local-development",
  S3_SECRET_ACCESS_KEY: "local-development-secret-change-me",
};

describe("process configuration", () => {
  it("parses a complete API configuration and applies defaults", () => {
    const result = parseApiConfig({
      AUTH_BASE_URL: "http://localhost:3001",
      WEB_ORIGIN: "http://localhost:3000",
      DATABASE_URL: "postgresql://app:app@localhost:5432/app",
      REDIS_URL: "redis://localhost:6379",
      AUTH_SECRET: "development-auth-secret-change-me-now",
      ...storageConfig,
    });

    expect(result).toMatchObject({
      NODE_ENV: "development",
      LOG_LEVEL: "info",
      API_HOST: "127.0.0.1",
      API_PORT: 3_001,
      API_DATABASE_POOL_MAX: 10,
      API_BODY_LIMIT_BYTES: 65_536,
      OBSERVABILITY_EXPORT_TIMEOUT_MS: 2_000,
      RATE_LIMIT_AUTH_MAX: 10,
      RATE_LIMIT_GENERAL_MAX: 120,
      RATE_LIMIT_MUTATION_MAX: 30,
      RATE_LIMIT_WINDOW_MS: 60_000,
      SHUTDOWN_TIMEOUT_MS: 10_000,
      S3_FORCE_PATH_STYLE: true,
      TECHNICAL_HARNESS_ENABLED: false,
    });
  });

  it("allows the technical harness only outside production", () => {
    const input = {
      AUTH_BASE_URL: "http://localhost:3001",
      AUTH_SECRET: "development-auth-secret-change-me-now",
      DATABASE_URL: "postgresql://app:app@localhost:5432/app",
      REDIS_URL: "redis://localhost:6379",
      TECHNICAL_HARNESS_ENABLED: "true",
      WEB_ORIGIN: "http://localhost:3000",
      ...storageConfig,
    } as const;

    expect(parseApiConfig(input).TECHNICAL_HARNESS_ENABLED).toBe(true);
    expect(() => parseApiConfig({ ...input, NODE_ENV: "production" })).toThrow(
      /TECHNICAL_HARNESS_ENABLED/u,
    );
  });

  it("supports virtual-host style for managed S3-compatible providers", () => {
    const result = parseWorkerConfig({
      DATABASE_URL: "postgres://app:app@localhost:5432/app",
      REDIS_URL: "redis://localhost:6379",
      ...storageConfig,
      S3_FORCE_PATH_STYLE: "false",
    });

    expect(result.S3_FORCE_PATH_STYLE).toBe(false);
  });

  it("fails before startup when a required server variable is absent", () => {
    expect(() =>
      parseApiConfig({
        AUTH_BASE_URL: "http://localhost:3001",
        WEB_ORIGIN: "http://localhost:3000",
        REDIS_URL: "redis://localhost:6379",
        AUTH_SECRET: "development-auth-secret-change-me-now",
        ...storageConfig,
      }),
    ).toThrow();
  });

  it("rejects unsafe HTTP and rate-limit bounds", () => {
    expect(() =>
      parseApiConfig({
        AUTH_BASE_URL: "http://localhost:3001",
        WEB_ORIGIN: "http://localhost:3000",
        DATABASE_URL: "postgresql://app:app@localhost:5432/app",
        REDIS_URL: "redis://localhost:6379",
        AUTH_SECRET: "development-auth-secret-change-me-now",
        API_BODY_LIMIT_BYTES: "1048577",
        RATE_LIMIT_AUTH_MAX: "0",
        ...storageConfig,
      }),
    ).toThrow();
  });

  it("rejects unsafe observability endpoints and lifecycle bounds", () => {
    expect(() =>
      parseWorkerConfig({
        DATABASE_URL: "postgresql://app:app@localhost:5432/app",
        OBSERVABILITY_EXPORT_TIMEOUT_MS: "99",
        OTEL_EXPORTER_OTLP_ENDPOINT: "file:///tmp/collector",
        REDIS_URL: "redis://localhost:6379",
        SHUTDOWN_TIMEOUT_MS: "999",
        ...storageConfig,
      }),
    ).toThrow();
  });

  it("keeps server-only values out of the client-safe result", () => {
    const result = parseClientConfig({
      NEXT_PUBLIC_API_URL: "http://localhost:3001",
      NEXT_PUBLIC_SOCKET_URL: "http://localhost:3001",
      AUTH_SECRET: "must-not-cross-the-client-boundary",
      DATABASE_URL: "postgresql://private",
    });

    expect(result).toEqual({
      NEXT_PUBLIC_API_URL: "http://localhost:3001",
      NEXT_PUBLIC_SOCKET_URL: "http://localhost:3001",
    });
    expect(result).not.toHaveProperty("AUTH_SECRET");
    expect(result).not.toHaveProperty("DATABASE_URL");
  });

  it("coerces bounded worker concurrency", () => {
    const result = parseWorkerConfig({
      DATABASE_URL: "postgres://app:app@localhost:5432/app",
      REDIS_URL: "rediss://localhost:6379",
      WORKER_CONCURRENCY: "20",
      ...storageConfig,
    });

    expect(result.WORKER_CONCURRENCY).toBe(20);
    expect(result.WORKER_DATABASE_POOL_MAX).toBe(5);
    expect(result.WORKER_PROBE_HOST).toBe("127.0.0.1");
    expect(result.WORKER_PROBE_PORT).toBe(3_002);
  });

  it("rejects database pool limits outside the operational bounds", () => {
    expect(() =>
      parseWorkerConfig({
        DATABASE_URL: "postgres://app:app@localhost:5432/app",
        WORKER_DATABASE_POOL_MAX: "0",
        REDIS_URL: "redis://localhost:6379",
        ...storageConfig,
      }),
    ).toThrow();
  });
});
