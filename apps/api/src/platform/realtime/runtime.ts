import type { AuthRuntime } from "@arquibancada-viva/auth";
import type { ApiConfig } from "@arquibancada-viva/config/api";
import type { Database } from "@arquibancada-viva/database";
import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { noopObservability, type Observability } from "@arquibancada-viva/observability";
import { mountAuthSocket } from "../auth/socket-auth.js";
import { createRealtimeRedisRuntime } from "./redis-runtime.js";
import { mountRealtimeSocket } from "./socket.js";

interface RuntimeLogger {
  error?(details: unknown, message?: string): void;
  warn?(details: unknown, message?: string): void;
}

export interface SocketRuntime {
  checkRedis(): Promise<void>;
  close(): Promise<void>;
  start(): Promise<void>;
}

export function createSocketRuntime(
  server: HttpServer,
  auth: AuthRuntime,
  config: ApiConfig,
  database: Database,
  logger?: RuntimeLogger,
  observability: Observability = noopObservability,
): SocketRuntime {
  const io = new Server(server, {
    allowRequest(request, callback) {
      const origin = request.headers.origin;
      callback(null, origin === undefined || origin === config.WEB_ORIGIN);
    },
    cors: { credentials: true, origin: config.WEB_ORIGIN },
    maxHttpBufferSize: 16 * 1024,
    serveClient: false,
  });
  mountAuthSocket(io, auth);
  const matches = mountRealtimeSocket(io, auth, database, observability);
  const redis = createRealtimeRedisRuntime(io, config.REDIS_URL, matches.emitLocal, logger);
  let closePromise: Promise<void> | undefined;

  return {
    checkRedis: () => redis.checkConnection(),
    close() {
      closePromise ??= (async () => {
        await new Promise<void>((resolve) => io.close(() => resolve()));
        await redis.close();
      })();
      return closePromise;
    },
    start: () => redis.start(),
  };
}
