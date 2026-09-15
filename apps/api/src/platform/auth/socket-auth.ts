import type { AuthRuntime } from "@arquibancada-viva/auth";
import type { ApiConfig } from "@arquibancada-viva/config/api";
import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";

export interface AuthSocketRuntime {
  close(): Promise<void>;
}

export function mountAuthSocket(
  server: HttpServer,
  auth: AuthRuntime,
  config: ApiConfig,
): AuthSocketRuntime {
  const io = new Server(server, {
    allowRequest(request, callback) {
      const origin = request.headers.origin;
      callback(null, origin === undefined || origin === config.WEB_ORIGIN);
    },
    cors: {
      credentials: true,
      origin: config.WEB_ORIGIN,
    },
    serveClient: false,
  });
  const namespace = io.of("/auth");

  namespace.use(async (socket, next) => {
    try {
      const identity = await auth.resolveIdentity(socket.handshake.headers);
      if (!identity) {
        const error = new Error("Authentication required");
        Object.assign(error, { data: { code: "UNAUTHORIZED" } });
        next(error);
        return;
      }
      socket.data.authIdentity = identity;
      next();
    } catch {
      const error = new Error("Authentication failed");
      Object.assign(error, { data: { code: "AUTH_FAILURE" } });
      next(error);
    }
  });

  namespace.on("connection", (socket) => {
    socket.emit("auth:session", socket.data.authIdentity);
  });

  let closePromise: Promise<void> | undefined;
  return {
    close() {
      closePromise ??= new Promise<void>((resolve) => io.close(() => resolve()));
      return closePromise;
    },
  };
}
