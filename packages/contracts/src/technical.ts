import { z } from "zod";
import { uuidV7Schema } from "./identifiers";
import { isoUtcDateTimeSchema } from "./time";

export const technicalActionSchema = z.enum(["battery", "mosaic", "fireworks", "flag"]);

export const technicalActionRequestSchema = z
  .strictObject({
    action: technicalActionSchema,
    version: z.literal(1),
  })
  .readonly();

export const technicalActionResponseSchema = z
  .strictObject({
    accepted: z.literal(true),
    committedAt: isoUtcDateTimeSchema,
    eventId: uuidV7Schema,
    matchId: uuidV7Schema,
    replayed: z.boolean(),
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .readonly();

export type TechnicalAction = z.infer<typeof technicalActionSchema>;
export type TechnicalActionRequest = z.infer<typeof technicalActionRequestSchema>;
export type TechnicalActionResponse = z.infer<typeof technicalActionResponseSchema>;
