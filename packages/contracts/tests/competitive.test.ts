import { describe, expect, it } from "vitest";
import {
  COMPETITIVE_ERROR_PRECEDENCE,
  COMPETITIVE_ERROR_STATUS,
  competitiveActionReceiptSchema,
  competitiveActionRequestSchema,
  competitiveBuildSchema,
  competitiveIdempotencyKeySchema,
  competitiveMeSchema,
  competitiveProblemDetailsSchema,
  competitivePublicProjectionSchema,
  competitiveRealtimeEventSchema,
  competitiveSideRequestSchema,
  competitiveSnapshotSchema,
  matchRealtimeEventSchema,
  matchSnapshotSchema,
} from "../src/index.js";

const actionId = "01890f47-3c2a-7b5d-9f23-123456789abc";
const matchId = "01890f47-3c2a-7b5d-af23-123456789abc";
const homeId = "01890f47-3c2a-7b5d-8f23-123456789abc";
const awayId = "01890f47-3c2a-7b5d-bf23-123456789abc";
const at = "2026-09-30T12:00:00.000Z";
const build = {
  battery: { level: 1, xp: 2 },
  mosaic: { level: 0, xp: 0 },
  fireworks: { level: 0, xp: 0 },
  flag: { level: 0, xp: 0 },
  totalLevel: 1,
  skillPoints: 0,
};
const side = (groupId: string) => ({
  groupId,
  scoreTenths: { battery: 101, mosaic: 0, fireworks: 0, flag: 0 },
  totalTenths: 101,
  dominatedModalities: 0,
});
const projection = {
  domain: "competitive",
  schemaVersion: 1,
  state: "active",
  pendingFinalization: false,
  startsAt: at,
  endsAt: "2026-09-30T14:00:00.000Z",
  sides: { home: side(homeId), away: side(awayId) },
  result: null,
};
const snapshot = {
  version: 1,
  matchId,
  generatedAt: at,
  latestSequence: 1,
  projection,
};
const event = {
  version: 1,
  eventId: actionId,
  matchId,
  sequence: 1,
  occurredAt: at,
  eventType: "match.action-accepted.v1",
  payload: projection,
};
const receipt = {
  version: 1,
  actionId,
  matchId,
  eventId: actionId,
  sequence: 1,
  acceptedAt: at,
  deltaTenths: 101,
  groupId: homeId,
  modality: "battery",
  nextAllowedAt: "2026-09-30T12:00:45.000Z",
  ownBuildAfter: build,
  replayed: false,
};

describe("competitive contracts v1", () => {
  it("accepts only client intention, never client authority", () => {
    const request = { actionId, modality: "battery", groupId: homeId };
    expect(competitiveActionRequestSchema.parse(request)).toEqual(request);
    expect(competitiveActionRequestSchema.safeParse({ actionId, modality: "flag" }).success).toBe(
      true,
    );
    for (const field of ["userId", "points", "sample", "xp", "acceptedAt", "rules", "version"]) {
      expect(competitiveActionRequestSchema.safeParse({ ...request, [field]: 1 }).success).toBe(
        false,
      );
    }
    expect(
      competitiveActionRequestSchema.safeParse({ ...request, modality: "drums" }).success,
    ).toBe(false);
    expect(
      competitiveActionRequestSchema.safeParse({
        ...request,
        actionId: "550e8400-e29b-41d4-a716-446655440000",
      }).success,
    ).toBe(false);
    expect(competitiveSideRequestSchema.parse({ groupId: homeId })).toEqual({ groupId: homeId });
    expect(competitiveSideRequestSchema.safeParse({ groupId: homeId, locked: true }).success).toBe(
      false,
    );
    expect(competitiveIdempotencyKeySchema.safeParse("short").success).toBe(false);
    expect(competitiveIdempotencyKeySchema.safeParse("x".repeat(201)).success).toBe(false);
    expect(competitiveIdempotencyKeySchema.parse(" opaque key ")).toBe(" opaque key ");
  });

  it("keeps accepted/replayed receipt private and never calls evaluation COMMIT", () => {
    expect(competitiveActionReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(competitiveActionReceiptSchema.parse({ ...receipt, replayed: true }).replayed).toBe(
      true,
    );
    expect(competitiveActionReceiptSchema.safeParse({ ...receipt, committedAt: at }).success).toBe(
      false,
    );
    expect(competitiveActionReceiptSchema.safeParse({ ...receipt, sample: 1999 }).success).toBe(
      false,
    );
    expect(
      competitiveMeSchema.safeParse({
        version: 1,
        matchId,
        selectedGroupId: homeId,
        lockedGroupId: homeId,
        build,
        nextAllowedAt: receipt.nextAllowedAt,
      }).success,
    ).toBe(true);
  });

  it.each(["userId", "actionId", "xp", "build", "ownBuildAfter", "sample", "key", "nextAllowedAt"])(
    "rejects private %s in public payload, nested side and envelope",
    (field) => {
      expect(
        competitiveRealtimeEventSchema.safeParse({
          ...event,
          payload: { ...projection, [field]: "private" },
        }).success,
      ).toBe(false);
      expect(
        competitiveRealtimeEventSchema.safeParse({
          ...event,
          payload: {
            ...projection,
            sides: { ...projection.sides, home: { ...side(homeId), [field]: "private" } },
          },
        }).success,
      ).toBe(false);
      expect(
        competitiveRealtimeEventSchema.safeParse({ ...event, [field]: "private" }).success,
      ).toBe(false);
    },
  );

  it("preserves envelope v1 and separates technical from competitive projections", () => {
    expect(competitiveRealtimeEventSchema.parse(event)).toEqual(event);
    expect(matchRealtimeEventSchema.safeParse(event).success).toBe(true);
    expect(competitiveSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(matchSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      competitiveRealtimeEventSchema.safeParse({ ...event, eventType: "technical.score-updated" })
        .success,
    ).toBe(false);
    expect(competitiveSnapshotSchema.safeParse({ ...snapshot, projection: {} }).success).toBe(
      false,
    );
    expect(competitiveRealtimeEventSchema.safeParse({ ...event, version: 2 }).success).toBe(false);
    expect(
      competitiveRealtimeEventSchema.safeParse({
        ...event,
        payload: { ...projection, schemaVersion: 2 },
      }).success,
    ).toBe(false);
    expect(competitiveSnapshotSchema.safeParse({ ...snapshot, version: 2 }).success).toBe(false);
    expect(competitiveActionReceiptSchema.safeParse({ ...receipt, version: 2 }).success).toBe(
      false,
    );
  });

  it("distinguishes pending finalization from a final result", () => {
    expect(
      competitivePublicProjectionSchema.safeParse({ ...projection, pendingFinalization: true })
        .success,
    ).toBe(true);
    const finished = {
      ...projection,
      state: "finished",
      result: { winnerGroupId: null, decidedBy: "draw" },
    };
    expect(
      competitiveRealtimeEventSchema.safeParse({
        ...event,
        eventType: "match.finished.v1",
        payload: finished,
      }).success,
    ).toBe(true);
    expect(
      competitivePublicProjectionSchema.safeParse({ ...finished, pendingFinalization: true })
        .success,
    ).toBe(false);
    expect(
      competitivePublicProjectionSchema.safeParse({ ...projection, state: "finished" }).success,
    ).toBe(false);
    expect(
      competitivePublicProjectionSchema.safeParse({ ...projection, result: finished.result })
        .success,
    ).toBe(false);
    expect(
      competitivePublicProjectionSchema.safeParse({
        ...finished,
        result: { winnerGroupId: homeId, decidedBy: "draw" },
      }).success,
    ).toBe(false);
  });

  it("uses safe exact integers without coercion and validates UTC and derived totals", () => {
    for (const invalid of [-1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1"]) {
      expect(
        competitiveActionReceiptSchema.safeParse({ ...receipt, sequence: invalid }).success,
      ).toBe(false);
      expect(
        competitiveActionReceiptSchema.safeParse({ ...receipt, deltaTenths: invalid }).success,
      ).toBe(false);
      expect(
        competitiveBuildSchema.safeParse({ ...build, battery: { level: 1, xp: invalid } }).success,
      ).toBe(false);
    }
    expect(
      competitiveActionReceiptSchema.safeParse({
        ...receipt,
        acceptedAt: "2026-09-30T09:00:00-03:00",
      }).success,
    ).toBe(false);
    expect(
      competitiveBuildSchema.safeParse({ ...build, battery: { level: 51, xp: 0 } }).success,
    ).toBe(false);
    expect(competitiveBuildSchema.safeParse({ ...build, totalLevel: 100 }).success).toBe(false);
    expect(competitiveBuildSchema.safeParse({ ...build, skillPoints: 20 }).success).toBe(false);
    expect(
      competitivePublicProjectionSchema.safeParse({
        ...projection,
        sides: { home: side(homeId), away: side(homeId) },
      }).success,
    ).toBe(false);
    expect(competitivePublicProjectionSchema.safeParse({ ...projection, endsAt: at }).success).toBe(
      false,
    );
    expect(
      competitivePublicProjectionSchema.safeParse({
        ...projection,
        sides: { ...projection.sides, home: { ...side(homeId), totalTenths: 10 } },
      }).success,
    ).toBe(false);
  });

  it("validates modality dominance and final winner, including lower-total winner", () => {
    const home = {
      groupId: homeId,
      scoreTenths: { battery: 1, mosaic: 1, fireworks: 1, flag: 0 },
      totalTenths: 3,
      dominatedModalities: 3,
    };
    const away = {
      groupId: awayId,
      scoreTenths: { battery: 0, mosaic: 0, fireworks: 0, flag: 1000 },
      totalTenths: 1000,
      dominatedModalities: 1,
    };
    const finished = {
      ...projection,
      sides: { home, away },
      state: "finished",
      result: { winnerGroupId: homeId, decidedBy: "dominance" },
    };
    expect(competitivePublicProjectionSchema.safeParse(finished).success).toBe(true);
    expect(
      competitivePublicProjectionSchema.safeParse({
        ...finished,
        result: { winnerGroupId: awayId, decidedBy: "total" },
      }).success,
    ).toBe(false);
    expect(
      competitivePublicProjectionSchema.safeParse({
        ...finished,
        sides: { home: { ...home, dominatedModalities: 2 }, away },
      }).success,
    ).toBe(false);
    const totalTiebreaker = {
      ...finished,
      sides: {
        home: {
          ...home,
          scoreTenths: { battery: 1, mosaic: 0, fireworks: 0, flag: 0 },
          totalTenths: 1,
          dominatedModalities: 1,
        },
        away,
      },
      result: { winnerGroupId: awayId, decidedBy: "total" },
    };
    expect(competitivePublicProjectionSchema.safeParse(totalTiebreaker).success).toBe(true);
    expect(
      competitivePublicProjectionSchema.safeParse({
        ...totalTiebreaker,
        result: { winnerGroupId: homeId, decidedBy: "dominance" },
      }).success,
    ).toBe(false);
  });

  it("requires stable rejection status and recovery fields without private data", () => {
    for (const [code, status] of Object.entries(COMPETITIVE_ERROR_STATUS)) {
      const problem = {
        type: "about:blank",
        title: "Requisição recusada",
        detail: "A ação não foi confirmada.",
        status,
        code,
        ...(code === "COOLDOWN_ACTIVE" ? { nextAllowedAt: receipt.nextAllowedAt } : {}),
      };
      expect(competitiveProblemDetailsSchema.safeParse(problem).success).toBe(true);
      expect(competitiveProblemDetailsSchema.safeParse({ ...problem, status: 418 }).success).toBe(
        false,
      );
      expect(competitiveProblemDetailsSchema.safeParse({ ...problem, sample: 123 }).success).toBe(
        false,
      );
    }
    expect(COMPETITIVE_ERROR_PRECEDENCE.indexOf("session")).toBeLessThan(
      COMPETITIVE_ERROR_PRECEDENCE.indexOf("receiptConflict"),
    );
    expect(COMPETITIVE_ERROR_PRECEDENCE.indexOf("receiptConflict")).toBeLessThan(
      COMPETITIVE_ERROR_PRECEDENCE.indexOf("cooldown"),
    );
  });
});
