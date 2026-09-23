import type { AuthRuntime } from "@arquibancada-viva/auth";
import type { Server } from "socket.io";

export function mountAuthSocket(io: Server, auth: AuthRuntime): void {
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
}
