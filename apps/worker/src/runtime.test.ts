import { parseWorkerConfig } from "@arquibancada-viva/config/worker";
import { request } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkerDependencies } from "./dependencies.js";
import { createWorkerRuntime, type WorkerRuntime } from "./runtime.js";

const validEnvironment = {
  DATABASE_URL: "postgresql://app:app@127.0.0.1:5432/test",
  LOG_LEVEL: "fatal",
  NODE_ENV: "test",
  REDIS_URL: "redis://127.0.0.1:6379",
  S3_ACCESS_KEY_ID: "test-access",
  S3_BUCKET: "test-bucket",
  S3_ENDPOINT: "http://127.0.0.1:9000",
  S3_REGION: "us-east-1",
  S3_SECRET_ACCESS_KEY: "test-only-storage-secret-32-characters",
  WORKER_PROBE_HOST: "127.0.0.1",
  WORKER_PROBE_PORT: "3102",
} as const;

interface ProbeResult {
  readonly body: Record<string, unknown>;
  readonly statusCode: number;
}

async function probe(runtime: WorkerRuntime, path: string): Promise<ProbeResult> {
  const address = runtime.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Worker sem endereço TCP.");
  }

  return new Promise((resolve, reject) => {
    const probeRequest = request(
      { host: "127.0.0.1", method: "GET", path, port: address.port },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
            statusCode: response.statusCode ?? 0,
          });
        });
      },
    );
    probeRequest.on("error", reject);
    probeRequest.end();
  });
}

describe("worker operational probes", () => {
  let runtime: WorkerRuntime | undefined;

  afterEach(async () => {
    await runtime?.close();
  });

  async function start(dependencies: WorkerDependencies): Promise<WorkerRuntime> {
    const config = {
      ...parseWorkerConfig(validEnvironment),
      WORKER_PROBE_PORT: 0,
    };
    runtime = createWorkerRuntime(config, dependencies, () => undefined);
    await runtime.listen();
    return runtime;
  }

  it("reports liveness and readiness independently", async () => {
    const close = vi.fn(async () => undefined);
    const startDependency = vi.fn(async () => undefined);
    const currentRuntime = await start({
      checkReadiness: async () => ({ postgres: "up", redis: "up", storage: "up" }),
      close,
      start: startDependency,
    });

    expect(await probe(currentRuntime, "/health")).toEqual({
      body: { service: "worker", status: "ok" },
      statusCode: 200,
    });
    expect(await probe(currentRuntime, "/ready")).toEqual({
      body: {
        checks: { postgres: "up", redis: "up", storage: "up" },
        service: "worker",
        status: "ready",
      },
      statusCode: 200,
    });

    await currentRuntime.close();
    await currentRuntime.close();
    expect(close).toHaveBeenCalledOnce();
    expect(startDependency).toHaveBeenCalledOnce();
  });

  it("keeps liveness up while failed dependencies return 503 readiness", async () => {
    const currentRuntime = await start({
      checkReadiness: async () => ({ postgres: "down", redis: "up", storage: "down" }),
      close: async () => undefined,
      start: async () => undefined,
    });

    expect((await probe(currentRuntime, "/ready")).statusCode).toBe(503);
    expect((await probe(currentRuntime, "/health")).statusCode).toBe(200);
    expect((await probe(currentRuntime, "/unknown")).statusCode).toBe(404);
  });

  it("stops accepting probes before waiting for dependencies to drain", async () => {
    let release: (() => void) | undefined;
    const dependenciesClosed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const currentRuntime = await start({
      checkReadiness: async () => ({ postgres: "up", redis: "up", storage: "up" }),
      close: () => dependenciesClosed,
      start: async () => undefined,
    });

    const closing = currentRuntime.close();
    await vi.waitFor(() => expect(currentRuntime.server.listening).toBe(false));
    release?.();
    await expect(closing).resolves.toBeUndefined();
  });
});
