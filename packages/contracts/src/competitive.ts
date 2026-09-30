import { z } from "zod";
import { createEventEnvelopeSchema } from "./events";
import { uuidV7Schema } from "./identifiers";
import { isoUtcDateTimeSchema } from "./time";

export const COMPETITIVE_SCHEMA_VERSION = 1 as const;
export const competitiveModalitySchema = z.enum(["battery", "mosaic", "fireworks", "flag"]);
export const competitiveIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const competitiveSequenceSchema = competitiveIntegerSchema;

export const competitiveActionRequestSchema = z
  .strictObject({
    actionId: uuidV7Schema,
    modality: competitiveModalitySchema,
    groupId: uuidV7Schema.optional(),
  })
  .readonly();
export const competitiveSideRequestSchema = z.strictObject({ groupId: uuidV7Schema }).readonly();
// Opaque header: no trimming/coercion that could change the identity of an intention.
export const competitiveIdempotencyKeySchema = z.string().min(8).max(200);

const modalityProgressSchema = z
  .strictObject({ level: competitiveIntegerSchema.max(50), xp: competitiveIntegerSchema })
  .readonly();
export const competitiveBuildSchema = z
  .strictObject({
    battery: modalityProgressSchema,
    mosaic: modalityProgressSchema,
    fireworks: modalityProgressSchema,
    flag: modalityProgressSchema,
    totalLevel: competitiveIntegerSchema.max(100),
    skillPoints: competitiveIntegerSchema.max(20),
  })
  .refine(
    (build) =>
      build.totalLevel ===
        build.battery.level + build.mosaic.level + build.fireworks.level + build.flag.level &&
      build.skillPoints === Math.floor(build.totalLevel / 5),
    "Inconsistent derived build totals",
  )
  .readonly();

export const competitiveScoreSchema = z
  .strictObject({
    battery: competitiveIntegerSchema,
    mosaic: competitiveIntegerSchema,
    fireworks: competitiveIntegerSchema,
    flag: competitiveIntegerSchema,
  })
  .readonly();
const publicSideSchema = z
  .strictObject({
    groupId: uuidV7Schema,
    scoreTenths: competitiveScoreSchema,
    totalTenths: competitiveIntegerSchema,
    dominatedModalities: competitiveIntegerSchema.max(4),
  })
  .refine((side) => {
    const total =
      side.scoreTenths.battery +
      side.scoreTenths.mosaic +
      side.scoreTenths.fireworks +
      side.scoreTenths.flag;
    return Number.isSafeInteger(total) && total === side.totalTenths;
  }, "Inconsistent or unsafe score total")
  .readonly();
export const competitiveResultSchema = z
  .strictObject({
    winnerGroupId: uuidV7Schema.nullable(),
    decidedBy: z.enum(["dominance", "total", "draw"]),
  })
  .refine(
    (result) => (result.decidedBy === "draw") === (result.winnerGroupId === null),
    "Draw must have no winner",
  )
  .readonly();

// Wire sides carry group IDs; the orchestrator adapts core home/away + domains/totals.
// These checks validate an already computed projection, never accept client authority.
function hasConsistentPublicResult(projection: {
  sides: { home: z.infer<typeof publicSideSchema>; away: z.infer<typeof publicSideSchema> };
  result: z.infer<typeof competitiveResultSchema> | null;
}): boolean {
  const { home, away } = projection.sides;
  let homeDomains = 0;
  let awayDomains = 0;
  for (const modality of competitiveModalitySchema.options) {
    if (home.scoreTenths[modality] > away.scoreTenths[modality]) homeDomains += 1;
    if (away.scoreTenths[modality] > home.scoreTenths[modality]) awayDomains += 1;
  }
  if (homeDomains !== home.dominatedModalities || awayDomains !== away.dominatedModalities) {
    return false;
  }
  if (!projection.result) return true;
  const byDominance = homeDomains !== awayDomains;
  const byTotal = home.totalTenths !== away.totalTenths;
  const winnerGroupId = byDominance
    ? homeDomains > awayDomains
      ? home.groupId
      : away.groupId
    : byTotal
      ? home.totalTenths > away.totalTenths
        ? home.groupId
        : away.groupId
      : null;
  return (
    projection.result.winnerGroupId === winnerGroupId &&
    projection.result.decidedBy === (byDominance ? "dominance" : byTotal ? "total" : "draw")
  );
}

export const competitivePublicProjectionSchema = z
  .strictObject({
    domain: z.literal("competitive"),
    schemaVersion: z.literal(COMPETITIVE_SCHEMA_VERSION),
    state: z.enum(["scheduled", "active", "finished", "cancelled"]),
    pendingFinalization: z.boolean(),
    startsAt: isoUtcDateTimeSchema,
    endsAt: isoUtcDateTimeSchema,
    sides: z.strictObject({ home: publicSideSchema, away: publicSideSchema }).readonly(),
    result: competitiveResultSchema.nullable(),
  })
  .refine(
    (projection) =>
      Date.parse(projection.endsAt) > Date.parse(projection.startsAt) &&
      projection.sides.home.groupId !== projection.sides.away.groupId &&
      (projection.state === "finished") === (projection.result !== null) &&
      (!projection.pendingFinalization ||
        projection.state === "active" ||
        projection.state === "scheduled") &&
      (projection.result?.winnerGroupId == null ||
        projection.sides.home.groupId === projection.result.winnerGroupId ||
        projection.sides.away.groupId === projection.result.winnerGroupId),
    "Inconsistent public match lifecycle",
  )
  .refine(hasConsistentPublicResult, "Inconsistent modality dominance or final result")
  .readonly();

export const competitiveSnapshotSchema = z
  .strictObject({
    version: z.literal(1),
    matchId: uuidV7Schema,
    generatedAt: isoUtcDateTimeSchema,
    latestSequence: competitiveSequenceSchema,
    projection: competitivePublicProjectionSchema,
  })
  .readonly();

export const competitiveMeSchema = z
  .strictObject({
    version: z.literal(1),
    matchId: uuidV7Schema,
    selectedGroupId: uuidV7Schema.nullable(),
    lockedGroupId: uuidV7Schema.nullable(),
    build: competitiveBuildSchema,
    nextAllowedAt: isoUtcDateTimeSchema.nullable(),
  })
  .readonly();

// Receipt is private to the currently authorized account. acceptedAt is evaluation time,
// not COMMIT time; a replay conserves the original effect and its timestamps.
export const competitiveActionReceiptSchema = z
  .strictObject({
    version: z.literal(1),
    actionId: uuidV7Schema,
    matchId: uuidV7Schema,
    eventId: uuidV7Schema,
    sequence: competitiveSequenceSchema.positive(),
    acceptedAt: isoUtcDateTimeSchema,
    deltaTenths: competitiveIntegerSchema,
    groupId: uuidV7Schema,
    modality: competitiveModalitySchema,
    nextAllowedAt: isoUtcDateTimeSchema,
    ownBuildAfter: competitiveBuildSchema,
    replayed: z.boolean(),
  })
  .readonly();

export const competitiveActionAcceptedEventSchema = createEventEnvelopeSchema(
  "match.action-accepted.v1",
  competitivePublicProjectionSchema.refine(
    (projection) => projection.state === "active" && projection.result === null,
    "Action event requires active state",
  ),
);
export const competitiveFinishedEventSchema = createEventEnvelopeSchema(
  "match.finished.v1",
  competitivePublicProjectionSchema.refine(
    (projection) => projection.state === "finished" && !projection.pendingFinalization,
    "Finished event requires final result",
  ),
);
export const competitiveRealtimeEventSchema = z.union([
  competitiveActionAcceptedEventSchema,
  competitiveFinishedEventSchema,
]);

export const COMPETITIVE_ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  BETA_ACCESS_REQUIRED: 403,
  EMAIL_UNVERIFIED: 403,
  ACCOUNT_BLOCKED: 403,
  NOT_MEMBER: 403,
  MATCH_NOT_FOUND: 404,
  SIDE_REQUIRED: 409,
  SIDE_LOCKED: 409,
  MATCH_NOT_STARTED: 409,
  MATCH_ENDED: 409,
  MATCH_CANCELLED: 409,
  IDEMPOTENCY_KEY_CONFLICT: 409,
  NUMERIC_LIMIT: 409,
  COOLDOWN_ACTIVE: 429,
  COMMAND_BUSY: 503,
  DEPENDENCY_UNAVAILABLE: 503,
} as const;
export const competitiveErrorCodeSchema = z.enum(
  Object.keys(COMPETITIVE_ERROR_STATUS) as [
    keyof typeof COMPETITIVE_ERROR_STATUS,
    ...(keyof typeof COMPETITIVE_ERROR_STATUS)[],
  ],
);
// This documents precedence; transport/auth/account eligibility run before receipt lookup.
// Replays bypass only interval/side/cooldown/core evaluation, never current authorization.
export const COMPETITIVE_ERROR_PRECEDENCE = [
  "payload",
  "session",
  "accountEligibility",
  "matchAndMembership",
  "receiptConflict",
  "stateAndInterval",
  "side",
  "cooldown",
  "numericLimits",
] as const;
export const competitiveProblemDetailsSchema = z
  .strictObject({
    type: z.union([z.literal("about:blank"), z.string().url()]),
    title: z.string().trim().min(1).max(200),
    detail: z.string().trim().min(1).max(2_000),
    status: z.number().int().min(400).max(599),
    code: competitiveErrorCodeSchema,
    correlationId: uuidV7Schema.optional(),
    nextAllowedAt: isoUtcDateTimeSchema.optional(),
  })
  .refine(
    (problem) =>
      problem.status === COMPETITIVE_ERROR_STATUS[problem.code] &&
      (problem.code === "COOLDOWN_ACTIVE") === (problem.nextAllowedAt !== undefined),
    "Status/recovery fields must correspond to error code",
  )
  .readonly();

export type CompetitiveModality = z.infer<typeof competitiveModalitySchema>;
export type CompetitiveActionRequest = z.infer<typeof competitiveActionRequestSchema>;
export type CompetitiveSideRequest = z.infer<typeof competitiveSideRequestSchema>;
export type CompetitiveBuild = z.infer<typeof competitiveBuildSchema>;
export type CompetitiveScore = z.infer<typeof competitiveScoreSchema>;
export type CompetitiveResult = z.infer<typeof competitiveResultSchema>;
export type CompetitivePublicProjection = z.infer<typeof competitivePublicProjectionSchema>;
export type CompetitiveSnapshot = z.infer<typeof competitiveSnapshotSchema>;
export type CompetitiveMe = z.infer<typeof competitiveMeSchema>;
export type CompetitiveActionReceipt = z.infer<typeof competitiveActionReceiptSchema>;
export type CompetitiveRealtimeEvent = z.infer<typeof competitiveRealtimeEventSchema>;
export type CompetitiveProblemDetails = z.infer<typeof competitiveProblemDetailsSchema>;
export type CompetitiveErrorCode = z.infer<typeof competitiveErrorCodeSchema>;
