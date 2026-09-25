import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  createEventEnvelopeSchema,
  createPaginatedResponseSchema,
  isoUtcDateTimeSchema,
  matchJoinRequestSchema,
  matchRealtimeEventSchema,
  matchSnapshotSchema,
  paginationRequestSchema,
  problemDetailsSchema,
  reconcileRealtimeEvent,
  realtimeCursorFromSnapshot,
  sessionIdentitySchema,
  technicalFixtureJobDataSchema,
  technicalFixtureJobId,
  uuidV7Schema,
} from "../src/index.js";

const eventId = "01890f47-3c2a-7b5d-9f23-123456789abc";
const matchId = "01890f47-3c2a-7b5d-af23-123456789abc";

describe("shared contract primitives", () => {
  it("accepts UUIDv7 and rejects another UUID version", () => {
    expect(uuidV7Schema.safeParse(eventId).success).toBe(true);
    expect(uuidV7Schema.safeParse("550e8400-e29b-41d4-a716-446655440000").success).toBe(false);
  });

  it("accepts valid UTC instants and rejects offsets", () => {
    expect(isoUtcDateTimeSchema.safeParse("2026-09-13T12:30:45.123Z").success).toBe(true);
    expect(isoUtcDateTimeSchema.safeParse("2028-02-29T12:30:45Z").success).toBe(true);
    expect(isoUtcDateTimeSchema.safeParse("2026-09-13T09:30:45-03:00").success).toBe(false);
    expect(isoUtcDateTimeSchema.safeParse("2026-02-30T12:30:45Z").success).toBe(false);
    expect(isoUtcDateTimeSchema.safeParse("2027-02-29T12:30:45Z").success).toBe(false);
  });

  it("coerces pagination input and enforces the maximum", () => {
    expect(paginationRequestSchema.parse({ pageSize: "50" })).toEqual({ pageSize: 50 });
    expect(paginationRequestSchema.safeParse({ pageSize: 101 }).success).toBe(false);

    const responseSchema = createPaginatedResponseSchema(z.object({ id: uuidV7Schema }));
    expect(
      responseSchema.safeParse({ items: [{ id: eventId }], nextCursor: "next-page" }).success,
    ).toBe(true);
  });

  it("validates structured public errors", () => {
    expect(
      problemDetailsSchema.safeParse({
        type: "https://arquibancada-viva.example/problems/validation",
        title: "Requisição inválida",
        status: 400,
        code: "VALIDATION_ERROR",
        detail: "Um ou mais campos são inválidos.",
        correlationId: eventId,
      }).success,
    ).toBe(true);
    expect(
      problemDetailsSchema.safeParse({
        type: "about:blank",
        title: "Falha",
        status: 200,
        code: "UNKNOWN_CODE",
        detail: "Inválido.",
      }).success,
    ).toBe(false);
  });

  it("accepts only the stable public session identity", () => {
    expect(sessionIdentitySchema.parse({ sessionId: "session-1", userId: "user-1" })).toEqual({
      sessionId: "session-1",
      userId: "user-1",
    });
    expect(
      sessionIdentitySchema.safeParse({
        email: "private@example.test",
        sessionId: "1",
        userId: "2",
      }).success,
    ).toBe(false);
  });

  it("requires versioned, ordered event envelopes", () => {
    const schema = createEventEnvelopeSchema(
      "technical.fixture.created",
      z.object({ value: z.string() }),
    );
    const validEvent = {
      version: 1,
      eventId,
      matchId,
      sequence: 1,
      occurredAt: "2026-09-13T12:30:45Z",
      eventType: "technical.fixture.created",
      payload: { value: "ok" },
    };

    expect(schema.safeParse(validEvent).success).toBe(true);
    expect(schema.safeParse({ ...validEvent, version: 2 }).success).toBe(false);
    expect(schema.safeParse({ ...validEvent, sequence: 0 }).success).toBe(false);
  });

  it("validates versioned technical job payloads and deterministic IDs", () => {
    const payload = {
      correlationId: eventId,
      effectId: matchId,
      mode: "succeed",
      version: 1,
    };

    expect(technicalFixtureJobDataSchema.safeParse(payload).success).toBe(true);
    expect(technicalFixtureJobDataSchema.safeParse({ ...payload, version: 2 }).success).toBe(false);
    expect(technicalFixtureJobDataSchema.safeParse({ ...payload, unexpected: true }).success).toBe(
      false,
    );
    expect(technicalFixtureJobId(matchId)).toBe(`technical-fixture-${matchId}`);
  });

  it("validates realtime joins, snapshots and ordered events", () => {
    const snapshot = matchSnapshotSchema.parse({
      generatedAt: "2026-09-23T12:00:00Z",
      latestSequence: 4,
      matchId,
      projection: {},
      version: 1,
    });
    const event = matchRealtimeEventSchema.parse({
      eventId,
      eventType: "technical.score-updated",
      matchId,
      occurredAt: "2026-09-23T12:00:01Z",
      payload: { points: 10 },
      sequence: 5,
      version: 1,
    });

    expect(matchJoinRequestSchema.safeParse({ lastSequence: 4, matchId }).success).toBe(true);
    expect(matchJoinRequestSchema.safeParse({ lastSequence: -1, matchId }).success).toBe(false);
    const applied = reconcileRealtimeEvent(realtimeCursorFromSnapshot(snapshot), event);
    expect(applied.kind).toBe("apply");
    if (applied.kind !== "apply") {
      throw new Error("Evento contíguo deveria ser aplicável.");
    }
    expect(reconcileRealtimeEvent(applied.cursor, event).kind).toBe("duplicate");
    expect(
      reconcileRealtimeEvent(applied.cursor, { ...event, eventId: matchId, sequence: 7 }).kind,
    ).toBe("gap");
  });
});
