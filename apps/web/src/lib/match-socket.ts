import {
  type MatchJoinRequest,
  type MatchSnapshot,
  matchJoinRequestSchema,
  matchJoinResultSchema,
  matchSnapshotSchema,
  REALTIME_NAMESPACE,
} from "@arquibancada-viva/contracts";
import { io, type Socket } from "socket.io-client";

export interface MatchSocketPort {
  emit(
    event: "match:join",
    request: MatchJoinRequest,
    acknowledge: (payload: unknown) => void,
  ): unknown;
  off(
    event: "match:snapshot.v1" | "system:error.v1",
    listener: (payload: unknown) => void,
  ): unknown;
  on(event: "match:snapshot.v1" | "system:error.v1", listener: (payload: unknown) => void): unknown;
}

export function createMatchSocket(baseUrl: string): Socket {
  return io(`${baseUrl.replace(/\/$/u, "")}${REALTIME_NAMESPACE}`, {
    autoConnect: false,
    reconnection: true,
    transports: ["websocket", "polling"],
    withCredentials: true,
  });
}

export function requestAuthoritativeSnapshot(
  socket: MatchSocketPort,
  matchId: string,
  timeoutMs = 5_000,
): Promise<MatchSnapshot> {
  const request = matchJoinRequestSchema.parse({ matchId });
  return new Promise((resolve, reject) => {
    let acknowledged = false;
    let snapshot: MatchSnapshot | undefined;
    const timer = setTimeout(() => finish(new Error("SYNC_TIMEOUT")), timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      socket.off("match:snapshot.v1", onSnapshot);
      socket.off("system:error.v1", onSystemError);
    }
    function finish(error?: Error) {
      cleanup();
      if (error) {
        reject(error);
      } else if (acknowledged && snapshot) {
        resolve(snapshot);
      }
    }
    function onSnapshot(payload: unknown) {
      const parsed = matchSnapshotSchema.safeParse(payload);
      if (!parsed.success || parsed.data.matchId !== matchId) {
        finish(new Error("INVALID_SNAPSHOT"));
        return;
      }
      snapshot = parsed.data;
      if (acknowledged) {
        finish();
      }
    }
    function onSystemError() {
      finish(new Error("REALTIME_SYNC_FAILED"));
    }

    socket.on("match:snapshot.v1", onSnapshot);
    socket.on("system:error.v1", onSystemError);
    socket.emit("match:join", request, (payload) => {
      const parsed = matchJoinResultSchema.safeParse(payload);
      if (!parsed.success || !parsed.data.ok || parsed.data.sync !== "snapshot") {
        finish(new Error(parsed.success && !parsed.data.ok ? parsed.data.code : "INVALID_JOIN"));
        return;
      }
      acknowledged = true;
      if (snapshot) {
        finish();
      }
    });
  });
}
