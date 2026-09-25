import { z } from "zod";
import { uuidV7Schema } from "./identifiers";

export const errorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
]);

const problemTypeSchema = z.union([z.literal("about:blank"), z.string().url()]);

export const problemDetailsSchema = z
  .strictObject({
    type: problemTypeSchema,
    title: z.string().trim().min(1).max(200),
    status: z.number().int().min(400).max(599),
    code: errorCodeSchema,
    detail: z.string().trim().min(1).max(2_000),
    correlationId: uuidV7Schema.optional(),
  })
  .readonly();

export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
