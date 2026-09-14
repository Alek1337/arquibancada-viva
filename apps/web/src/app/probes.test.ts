import { describe, expect, it } from "vitest";
import { GET as health } from "./health/route.js";
import { readinessResponse } from "./ready/route.js";

describe("web operational probes", () => {
  it("reports liveness without depending on runtime integrations", async () => {
    const response = health();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ service: "web", status: "ok" });
  });

  it("only reports readiness with valid public configuration", async () => {
    const ready = readinessResponse({
      NEXT_PUBLIC_API_URL: "http://127.0.0.1:3001",
      NEXT_PUBLIC_SOCKET_URL: "http://127.0.0.1:3001",
    });
    const notReady = readinessResponse({});

    expect(ready.status).toBe(200);
    expect(notReady.status).toBe(503);
    await expect(notReady.json()).resolves.toMatchObject({
      checks: { configuration: "down" },
      status: "not_ready",
    });
  });
});
