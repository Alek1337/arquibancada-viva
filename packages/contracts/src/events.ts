import { z } from "zod";
import { uuidV7Schema } from "./identifiers";
import { isoUtcDateTimeSchema } from "./time";

export const EVENT_ENVELOPE_VERSION = 1 as const;

export function createEventEnvelopeSchema<
  const EventType extends string,
  const PayloadSchema extends z.ZodType,
>(eventType: EventType, payloadSchema: PayloadSchema) {
  return z
    .strictObject({
      version: z.literal(EVENT_ENVELOPE_VERSION),
      eventId: uuidV7Schema,
      matchId: uuidV7Schema,
      sequence: z.number().int().positive(),
      occurredAt: isoUtcDateTimeSchema,
      eventType: z.literal(eventType),
      payload: payloadSchema,
    })
    .readonly();
}
