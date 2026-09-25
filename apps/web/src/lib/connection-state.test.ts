import { matchRealtimeEventSchema, matchSnapshotSchema } from "@arquibancada-viva/contracts";
import { describe, expect, it } from "vitest";
import {
  acceptRealtimeEvent,
  acceptSnapshot,
  beginConnection,
  beginReconciliation,
  canSubmitCompetitiveCommand,
  markOffline,
} from "./connection-state.js";

const matchId = "01890f47-3c2a-7b5d-af23-123456789abc";
const eventId = "01890f47-3c2a-7b5d-9f23-123456789abc";
const snapshot = matchSnapshotSchema.parse({
  generatedAt: "2026-09-24T12:00:00Z",
  latestSequence: 4,
  matchId,
  projection: { battery: 120 },
  version: 1,
});

describe("authoritative client reconciliation", () => {
  it("only enables commands after an authoritative snapshot", () => {
    const connecting = beginConnection(matchId);
    const reconciling = beginReconciliation(connecting);
    const ready = acceptSnapshot(reconciling, snapshot);

    expect(canSubmitCompetitiveCommand(connecting)).toBe(false);
    expect(canSubmitCompetitiveCommand(reconciling)).toBe(false);
    expect(canSubmitCompetitiveCommand(ready)).toBe(true);
    expect(ready.projection).toEqual({ battery: 120 });
  });

  it("applies contiguous events and ignores duplicates", () => {
    const ready = acceptSnapshot(beginReconciliation(beginConnection(matchId)), snapshot);
    const event = matchRealtimeEventSchema.parse({
      eventId,
      eventType: "technical.score-updated",
      matchId,
      occurredAt: "2026-09-24T12:00:01Z",
      payload: { battery: 131 },
      sequence: 5,
      version: 1,
    });
    const applied = acceptRealtimeEvent(ready, event);

    expect(applied.cursor.latestSequence).toBe(5);
    expect(applied.projection).toEqual({ battery: 131 });
    expect(acceptRealtimeEvent(applied, event)).toBe(applied);
  });

  it("blocks commands on gaps and while offline", () => {
    const ready = acceptSnapshot(beginReconciliation(beginConnection(matchId)), snapshot);
    const gap = acceptRealtimeEvent(
      ready,
      matchRealtimeEventSchema.parse({
        eventId,
        eventType: "technical.score-updated",
        matchId,
        occurredAt: "2026-09-24T12:00:03Z",
        payload: { battery: 150 },
        sequence: 7,
        version: 1,
      }),
    );

    expect(gap.phase).toBe("reconciling");
    expect(canSubmitCompetitiveCommand(gap)).toBe(false);
    expect(canSubmitCompetitiveCommand(markOffline(ready))).toBe(false);
  });

  it("ignores a stale snapshot that arrives after the client goes offline", () => {
    const offline = markOffline(beginReconciliation(beginConnection(matchId)));

    expect(acceptSnapshot(offline, snapshot)).toBe(offline);
    expect(canSubmitCompetitiveCommand(offline)).toBe(false);
  });
});
