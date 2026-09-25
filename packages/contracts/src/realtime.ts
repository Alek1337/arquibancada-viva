import { z } from "zod";
import { uuidV7Schema } from "./identifiers";
import { isoUtcDateTimeSchema } from "./time";

export const REALTIME_EVENT_VERSION = 1 as const;
export const REALTIME_SNAPSHOT_VERSION = 1 as const;
export const REALTIME_EVENT_CHANNEL = "arquibancada-viva:realtime-events:v1" as const;
export const REALTIME_NAMESPACE = "/matches" as const;

const sequenceSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const matchJoinRequestSchema = z
  .strictObject({
    lastSequence: sequenceSchema.optional(),
    matchId: uuidV7Schema,
  })
  .readonly();

export const matchRealtimeEventSchema = z
  .strictObject({
    eventId: uuidV7Schema,
    eventType: z.string().min(1).max(100),
    matchId: uuidV7Schema,
    occurredAt: isoUtcDateTimeSchema,
    payload: z.record(z.string(), z.json()),
    sequence: sequenceSchema.positive(),
    version: z.literal(REALTIME_EVENT_VERSION),
  })
  .readonly();

export const matchSnapshotSchema = z
  .strictObject({
    generatedAt: isoUtcDateTimeSchema,
    latestSequence: sequenceSchema,
    matchId: uuidV7Schema,
    projection: z.record(z.string(), z.json()),
    version: z.literal(REALTIME_SNAPSHOT_VERSION),
  })
  .readonly();

export const matchJoinResultSchema = z.discriminatedUnion("ok", [
  z
    .strictObject({
      latestSequence: sequenceSchema,
      ok: z.literal(true),
      room: z.string().startsWith("match:"),
      sync: z.enum(["current", "replay", "snapshot"]),
    })
    .readonly(),
  z
    .strictObject({
      code: z.enum(["INTERNAL_ERROR", "INVALID_PAYLOAD", "MATCH_NOT_FOUND"]),
      ok: z.literal(false),
    })
    .readonly(),
]);

export interface RealtimeCursor {
  readonly latestSequence: number;
  readonly recentEventIds: readonly string[];
}

export type RealtimeEventDecision =
  | { readonly kind: "apply"; readonly cursor: RealtimeCursor }
  | { readonly kind: "duplicate"; readonly cursor: RealtimeCursor }
  | { readonly kind: "gap"; readonly cursor: RealtimeCursor };

const MAX_RECENT_EVENT_IDS = 100;

export function reconcileRealtimeEvent(
  cursor: RealtimeCursor,
  event: z.infer<typeof matchRealtimeEventSchema>,
): RealtimeEventDecision {
  if (cursor.recentEventIds.includes(event.eventId) || event.sequence <= cursor.latestSequence) {
    return { cursor, kind: "duplicate" };
  }
  if (event.sequence !== cursor.latestSequence + 1) {
    return { cursor, kind: "gap" };
  }
  return {
    cursor: {
      latestSequence: event.sequence,
      recentEventIds: [...cursor.recentEventIds, event.eventId].slice(-MAX_RECENT_EVENT_IDS),
    },
    kind: "apply",
  };
}

export function realtimeCursorFromSnapshot(
  snapshot: z.infer<typeof matchSnapshotSchema>,
): RealtimeCursor {
  return { latestSequence: snapshot.latestSequence, recentEventIds: [] };
}

export type MatchJoinRequest = z.infer<typeof matchJoinRequestSchema>;
export type MatchJoinResult = z.infer<typeof matchJoinResultSchema>;
export type MatchRealtimeEvent = z.infer<typeof matchRealtimeEventSchema>;
export type MatchSnapshot = z.infer<typeof matchSnapshotSchema>;
