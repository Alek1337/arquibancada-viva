import type { WorkerConfig } from "@arquibancada-viva/config/worker";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { WorkerDependencies } from "./dependencies.js";
import type { WorkerLogger } from "./logger.js";
import {
  noopObservability,
  type Observability,
  settleWithin,
} from "@arquibancada-viva/observability";

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

export interface WorkerRuntime {
  readonly server: Server;
  close(): Promise<void>;
  listen(): Promise<void>;
}

export function createWorkerRuntime(
  config: WorkerConfig,
  dependencies: WorkerDependencies,
  logger: WorkerLogger,
  observability: Observability = noopObservability,
): WorkerRuntime {
  let closePromise: Promise<void> | undefined;
  let shuttingDown = false;

  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://worker.internal").pathname;

    if (request.method === "GET" && pathname === "/health") {
      sendJson(response, 200, {
        service: "worker",
        status: shuttingDown ? "shutting_down" : "ok",
      });
      return;
    }

    if (request.method === "GET" && pathname === "/ready") {
      if (shuttingDown) {
        sendJson(response, 503, {
          checks: { postgres: "down", redis: "down" },
          service: "worker",
          status: "not_ready",
        });
        return;
      }

      void dependencies
        .checkReadiness()
        .then((checks) => {
          const ready = Object.values(checks).every((status) => status === "up");
          sendJson(response, ready ? 200 : 503, {
            checks,
            service: "worker",
            status: ready ? "ready" : "not_ready",
          });
        })
        .catch(() => {
          sendJson(response, 503, {
            checks: { postgres: "down", redis: "down" },
            service: "worker",
            status: "not_ready",
          });
        });
      return;
    }

    sendJson(response, 404, {
      code: "NOT_FOUND",
      service: "worker",
      status: 404,
    });
  });

  return {
    server,
    close() {
      if (closePromise) {
        return closePromise;
      }

      shuttingDown = true;
      closePromise = settleWithin(
        (async () => {
          await Promise.all([
            new Promise<void>((resolve, reject) => {
              if (!server.listening) {
                resolve();
                return;
              }
              server.close((error) => (error ? reject(error) : resolve()));
            }),
            dependencies.close(),
          ]);
          await observability.shutdown();
          logger({ event: "worker.stopped", level: "info" });
        })(),
        config.SHUTDOWN_TIMEOUT_MS,
      );
      return closePromise;
    },
    async listen() {
      await dependencies.start();
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.WORKER_PROBE_PORT, config.WORKER_PROBE_HOST, () => {
          server.off("error", reject);
          logger({
            event: "worker.started",
            host: config.WORKER_PROBE_HOST,
            level: "info",
            port: config.WORKER_PROBE_PORT,
          });
          resolve();
        });
      });
    },
  };
}

export function registerWorkerShutdown(runtime: WorkerRuntime, logger: WorkerLogger): void {
  const shutdown = () => {
    void runtime.close().catch(() => {
      logger({ event: "worker.shutdown_failed", level: "error" });
      process.exitCode = 1;
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
