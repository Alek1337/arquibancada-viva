import { describe, expect, it, vi } from "vitest";
import { createRestClient, type RestClientError } from "./rest-client.js";

describe("typed REST client", () => {
  it("validates the stable session contract and sends credentials", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ sessionId: "session-1", userId: "user-1" }),
    );
    const client = createRestClient("https://api.example.test", fetcher);

    await expect(client.getSession()).resolves.toEqual({
      sessionId: "session-1",
      userId: "user-1",
    });
    expect(fetcher).toHaveBeenCalledWith("https://api.example.test/v1/me/session", {
      credentials: "include",
      headers: { accept: "application/json" },
    });
  });

  it("rejects a successful response that violates the shared contract", async () => {
    const client = createRestClient(
      "https://api.example.test",
      vi.fn<typeof fetch>(async () => Response.json({ email: "private@example.test" })),
    );

    await expect(client.getSession()).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      status: 502,
    } satisfies Partial<RestClientError>);
  });

  it("submits a versioned technical action with an idempotency key", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          accepted: true,
          committedAt: "2026-09-25T12:00:00.000Z",
          eventId: "01890f47-3c2a-7b5d-9f23-123456789abc",
          matchId: "01890f47-3c2a-7b5d-af23-123456789abc",
          replayed: false,
          sequence: 2,
        },
        { status: 202 },
      ),
    );
    const client = createRestClient("http://api.example.test", fetcher);

    await expect(
      client.submitTechnicalAction({
        action: "battery",
        idempotencyKey: "technical-key-123",
        matchId: "01890f47-3c2a-7b5d-af23-123456789abc",
      }),
    ).resolves.toMatchObject({ accepted: true, sequence: 2 });
    expect(fetcher).toHaveBeenCalledWith(
      "http://api.example.test/v1/technical/matches/01890f47-3c2a-7b5d-af23-123456789abc/actions",
      expect.objectContaining({
        body: JSON.stringify({ action: "battery", version: 1 }),
        method: "POST",
      }),
    );
  });
});
