import type { AuthIdentity, AuthRuntime } from "@arquibancada-viva/auth";
import type { Database } from "@arquibancada-viva/database";
import type { Server } from "socket.io";
import { describe, expect, it, vi } from "vitest";
import { mountRealtimeSocket } from "./socket.js";

const persistence = vi.hoisted(() => ({
  getRealtimeEventsAfter: vi.fn(),
  getRealtimeMatchProjection: vi.fn(),
  getRealtimeMatchState: vi.fn(),
}));
vi.mock("@arquibancada-viva/database", () => persistence);

const identity: AuthIdentity = { sessionId: "session-1", userId: "user-1" };

function connectedSocket(resolveIdentity: AuthRuntime["resolveIdentity"]) {
  const onConnection = vi.fn();
  const namespace = { on: onConnection, use: vi.fn() };
  const io = { of: () => namespace } as unknown as Server;
  mountRealtimeSocket(io, { handle: vi.fn(), resolveIdentity }, {} as Database);
  const onCommand = vi.fn();
  const socket = {
    connected: true,
    data: { authIdentity: identity },
    disconnect: vi.fn(),
    emit: vi.fn(),
    handshake: { headers: { cookie: "synthetic-session" } },
    id: "socket-1",
    join: vi.fn(),
    on: onCommand,
    once: vi.fn(),
  };
  onConnection.mock.calls[0]?.[1](socket);
  return { join: onCommand.mock.calls[0]?.[1], socket };
}

describe("realtime command session guard", () => {
  it.each(["not-a-callback", 42, {}, null])(
    "rejects malformed acknowledgement arguments (%j)",
    async (argument) => {
      vi.clearAllMocks();
      const { join, socket } = connectedSocket(async () => identity);
      await expect(join({ matchId: "not-a-uuid" }, argument)).resolves.toBeUndefined();
      expect(socket.emit).toHaveBeenCalledWith("system:error.v1", { code: "INVALID_PAYLOAD" });
      expect(socket.join).not.toHaveBeenCalled();
      expect(persistence.getRealtimeMatchState).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    { sessionId: identity.sessionId, userId: "other-user" },
    { sessionId: "other-session", userId: identity.userId },
  ])("rejects missing or replaced identity before accessing match state (%j)", async (current) => {
    vi.clearAllMocks();
    const resolve = vi.fn(async () => current);
    const { join, socket } = connectedSocket(resolve);
    const acknowledge = vi.fn();
    await join({ matchId: "01890f47-3c2a-7b5d-af23-123456789abc" }, acknowledge);
    expect(resolve).toHaveBeenCalledWith(socket.handshake.headers);
    expect(acknowledge).toHaveBeenCalledWith({ code: "UNAUTHORIZED", ok: false });
    expect(socket.disconnect).toHaveBeenCalledOnce();
    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
    expect(persistence.getRealtimeMatchState).not.toHaveBeenCalled();
  });

  it("fails closed without exposing an authentication lookup error", async () => {
    vi.clearAllMocks();
    const { join, socket } = connectedSocket(async () => {
      throw new Error("private database connection detail");
    });
    const acknowledge = vi.fn();
    await join({ matchId: "01890f47-3c2a-7b5d-af23-123456789abc" }, acknowledge);
    expect(acknowledge).toHaveBeenCalledWith({ code: "INTERNAL_ERROR", ok: false });
    expect(socket.disconnect).toHaveBeenCalledOnce();
    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
    expect(persistence.getRealtimeMatchState).not.toHaveBeenCalled();
  });
});
