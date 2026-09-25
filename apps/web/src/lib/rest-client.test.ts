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
});
