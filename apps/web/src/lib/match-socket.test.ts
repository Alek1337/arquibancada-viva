import type { MatchJoinRequest } from "@arquibancada-viva/contracts";
import { describe, expect, it, vi } from "vitest";
import { requestAuthoritativeSnapshot, type MatchSocketPort } from "./match-socket.js";

const matchId = "01890f47-3c2a-7b5d-af23-123456789abc";
const snapshot = {
  generatedAt: "2026-09-24T12:00:00Z",
  latestSequence: 4,
  matchId,
  projection: {},
  version: 1,
};

function fixtureSocket(
  order: "ack-first" | "snapshot-first",
  snapshotPayload: unknown = snapshot,
): MatchSocketPort {
  const listeners = new Map<string, (payload: unknown) => void>();
  return {
    emit(_event, request: MatchJoinRequest, acknowledge) {
      expect(request).toEqual({ matchId });
      const ack = () =>
        acknowledge({ latestSequence: 4, ok: true, room: `match:${matchId}`, sync: "snapshot" });
      const emitSnapshot = () => listeners.get("match:snapshot.v1")?.(snapshotPayload);
      if (order === "ack-first") {
        ack();
        emitSnapshot();
      } else {
        emitSnapshot();
        ack();
      }
    },
    off: vi.fn((event, listener) => {
      if (listeners.get(event) === listener) {
        listeners.delete(event);
      }
    }),
    on(event, listener) {
      listeners.set(event, listener);
    },
  };
}

describe("Socket.IO authoritative synchronization", () => {
  it.each(["ack-first", "snapshot-first"] as const)(
    "waits for both snapshot and acknowledgement when %s",
    async (order) => {
      await expect(requestAuthoritativeSnapshot(fixtureSocket(order), matchId)).resolves.toEqual(
        snapshot,
      );
    },
  );

  it("rejects instead of trusting an invalid snapshot", async () => {
    const socket = fixtureSocket("snapshot-first", { ...snapshot, latestSequence: -1 });

    await expect(requestAuthoritativeSnapshot(socket, matchId)).rejects.toThrow("INVALID_SNAPSHOT");
  });
});
