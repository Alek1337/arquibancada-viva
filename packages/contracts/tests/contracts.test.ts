import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  createEventEnvelopeSchema,
  createPaginatedResponseSchema,
  isoUtcDateTimeSchema,
  paginationRequestSchema,
  problemDetailsSchema,
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
});
