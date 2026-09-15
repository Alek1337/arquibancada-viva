import type { ApiConfig } from "@arquibancada-viva/config/api";
import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import type { BetterAuthSpike } from "./auth.js";
import { resolveBetterAuthSession } from "./session.js";

export interface BetterAuthSocketSpike {
  close(): Promise<void>;
}

export function mountBetterAuthSocketSpike(
  server: HttpServer,
  auth: BetterAuthSpike,
  config: ApiConfig,
): BetterAuthSocketSpike {
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
  const namespace = io.of("/auth-spike");

  namespace.use(async (socket, next) => {
    try {
      const session = await resolveBetterAuthSession(auth, socket.handshake.headers);
      if (!session) {
        const error = new Error("Authentication required");
        Object.assign(error, { data: { code: "UNAUTHORIZED" } });
        next(error);
        return;
      }
      socket.data.authSession = session;
      next();
    } catch {
      const error = new Error("Authentication failed");
      Object.assign(error, { data: { code: "AUTH_FAILURE" } });
      next(error);
    }
  });

  namespace.on("connection", (socket) => {
    const session = socket.data.authSession;
    socket.emit("auth:session", {
      sessionId: session.session.id,
      userId: session.user.id,
    });
  });

  let closePromise: Promise<void> | undefined;
  return {
    close() {
      closePromise ??= new Promise<void>((resolve) => io.close(() => resolve()));
      return closePromise;
    },
  };
}
