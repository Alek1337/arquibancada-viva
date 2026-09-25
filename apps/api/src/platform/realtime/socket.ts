import type { AuthRuntime } from "@arquibancada-viva/auth";
import {
  type MatchRealtimeEvent,
  matchJoinRequestSchema,
  matchJoinResultSchema,
  matchRealtimeEventSchema,
  matchSnapshotSchema,
  REALTIME_EVENT_VERSION,
  REALTIME_NAMESPACE,
  REALTIME_SNAPSHOT_VERSION,
} from "@arquibancada-viva/contracts";
import {
  type Database,
  getRealtimeEventsAfter,
  getRealtimeMatchProjection,
  getRealtimeMatchState,
} from "@arquibancada-viva/database";
import type { Namespace, Server } from "socket.io";
import { noopObservability, type Observability } from "@arquibancada-viva/observability";

const MAX_REPLAY_EVENTS = 100;
export const MATCH_EVENT_NAME = "match:event.v1";
export const MATCH_SNAPSHOT_NAME = "match:snapshot.v1";

type JoinAcknowledgement = (result: ReturnType<typeof matchJoinResultSchema.parse>) => void;

function roomName(matchId: string): string {
  return `match:${matchId}`;
}

function eventFromPersistence(
  event: Awaited<ReturnType<typeof getRealtimeEventsAfter>>[number],
): MatchRealtimeEvent {
  return matchRealtimeEventSchema.parse({
    eventId: event.eventId,
    eventType: event.eventType,
    matchId: event.matchId,
    occurredAt: event.occurredAt.toISOString(),
    payload: event.payload,
    sequence: event.sequence,
    version: REALTIME_EVENT_VERSION,
  });
}

export interface RealtimeSocketRuntime {
  emitLocal(event: MatchRealtimeEvent): void;
  readonly namespace: Namespace;
}

export function mountRealtimeSocket(
  io: Server,
  auth: AuthRuntime,
  database: Database,
  observability: Observability = noopObservability,
): RealtimeSocketRuntime {
  const namespace = io.of(REALTIME_NAMESPACE);

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
    const identity = socket.data.authIdentity as { readonly userId?: string } | undefined;
    observability.recordSocketConnection(1, {
      socketId: socket.id,
      ...(identity?.userId ? { userId: identity.userId } : {}),
    });
    socket.once("disconnect", () => {
      observability.recordSocketConnection(-1, {
        socketId: socket.id,
        ...(identity?.userId ? { userId: identity.userId } : {}),
      });
    });
    socket.on("match:join", async (rawRequest: unknown, acknowledge?: JoinAcknowledgement) => {
      const parsed = matchJoinRequestSchema.safeParse(rawRequest);
      if (!parsed.success) {
        acknowledge?.(matchJoinResultSchema.parse({ code: "INVALID_PAYLOAD", ok: false }));
        return;
      }

      const { lastSequence, matchId } = parsed.data;
      const room = roomName(matchId);
      const span = observability.startSpan("socket.match_join", {
        matchId,
        socketId: socket.id,
        ...(identity?.userId ? { userId: identity.userId } : {}),
      });
      try {
        const initialState = await getRealtimeMatchState(database, matchId);
        if (!initialState) {
          acknowledge?.(matchJoinResultSchema.parse({ code: "MATCH_NOT_FOUND", ok: false }));
          return;
        }

        await socket.join(room);
        const currentState = await getRealtimeMatchState(database, matchId);
        if (!currentState) {
          await socket.leave(room);
          acknowledge?.(matchJoinResultSchema.parse({ code: "MATCH_NOT_FOUND", ok: false }));
          return;
        }

        if (lastSequence === currentState.latestSequence) {
          acknowledge?.(
            matchJoinResultSchema.parse({
              latestSequence: currentState.latestSequence,
              ok: true,
              room,
              sync: "current",
            }),
          );
          return;
        }

        if (lastSequence !== undefined && lastSequence < currentState.latestSequence) {
          const persisted = await getRealtimeEventsAfter(database, {
            limit: MAX_REPLAY_EVENTS + 1,
            matchId,
            sequence: lastSequence,
          });
          const isContiguous =
            persisted.length <= MAX_REPLAY_EVENTS &&
            persisted.length > 0 &&
            persisted.every((event, index) => event.sequence === lastSequence + index + 1) &&
            persisted.at(-1)?.sequence === currentState.latestSequence;
          if (isContiguous) {
            for (const event of persisted) {
              socket.emit(MATCH_EVENT_NAME, eventFromPersistence(event));
            }
            acknowledge?.(
              matchJoinResultSchema.parse({
                latestSequence: currentState.latestSequence,
                ok: true,
                room,
                sync: "replay",
              }),
            );
            return;
          }
        }

        socket.emit(
          MATCH_SNAPSHOT_NAME,
          matchSnapshotSchema.parse({
            generatedAt: new Date().toISOString(),
            latestSequence: currentState.latestSequence,
            matchId,
            projection: await getRealtimeMatchProjection(database, {
              latestSequence: currentState.latestSequence,
              matchId,
            }),
            version: REALTIME_SNAPSHOT_VERSION,
          }),
        );
        acknowledge?.(
          matchJoinResultSchema.parse({
            latestSequence: currentState.latestSequence,
            ok: true,
            room,
            sync: "snapshot",
          }),
        );
      } catch {
        span.fail("REALTIME_SYNC_FAILED");
        observability.captureException("REALTIME_SYNC_FAILED", {
          matchId,
          socketId: socket.id,
          ...(identity?.userId ? { userId: identity.userId } : {}),
        });
        await socket.leave(room);
        acknowledge?.(matchJoinResultSchema.parse({ code: "INTERNAL_ERROR", ok: false }));
        socket.emit("system:error.v1", { code: "REALTIME_SYNC_FAILED" });
      } finally {
        span.end();
      }
    });
  });

  return {
    emitLocal(event) {
      namespace.local.to(roomName(event.matchId)).emit(MATCH_EVENT_NAME, event);
    },
    namespace,
  };
}
