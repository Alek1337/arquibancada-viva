import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io as createClient, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { createRealtimeRedisRuntime } from "./redis-runtime.js";

describe("realtime Redis degradation", () => {
  let client: Socket | undefined;
  let io: Server | undefined;
  let closeRedis: (() => Promise<void>) | undefined;

  afterEach(async () => {
    client?.close();
    if (io) {
      await new Promise<void>((resolve) => io?.close(() => resolve()));
    }
    await closeRedis?.();
  });

  it("keeps local Socket.IO delivery available when Redis is unavailable", async () => {
    const httpServer = createServer();
    io = new Server(httpServer, { transports: ["websocket"] });
    const runtime = createRealtimeRedisRuntime(io, "redis://127.0.0.1:63998", () => undefined);
    closeRedis = () => runtime.close();
    await runtime.start();

    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const { port } = httpServer.address() as AddressInfo;
    client = createClient(`http://127.0.0.1:${port}`, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
    });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout na conexão local.")), 5_000);
      client?.once("connect_error", reject);
      client?.once("connect", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    const received = new Promise((resolve) => client?.once("technical:event", resolve));
    io.local.emit("technical:event", { durable: true });

    await expect(received).resolves.toEqual({ durable: true });
    await expect(runtime.checkConnection()).rejects.toThrow("Redis realtime indisponível");
  }, 10_000);
});
