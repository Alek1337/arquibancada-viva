import { describe, expect, it } from "vitest";
import { createBetterAuthWebRequest } from "./fastify-adapter.js";

describe("Better Auth Fastify request bridge", () => {
  it("serializes parsed JSON exactly once", async () => {
    const request = createBetterAuthWebRequest({
      baseURL: "https://api.example.test",
      body: { email: "fixture@example.test", rememberMe: true },
      headers: { "content-type": "application/json" },
      method: "POST",
      url: "/v1/auth/sign-in/email",
    });

    expect(request.url).toBe("https://api.example.test/v1/auth/sign-in/email");
    await expect(request.json()).resolves.toEqual({
      email: "fixture@example.test",
      rememberMe: true,
    });
  });

  it("preserves raw byte bodies supplied by a Fastify parser", async () => {
    const rawBody = Buffer.from([0, 1, 2, 127, 128, 255]);
    const request = createBetterAuthWebRequest({
      baseURL: "https://api.example.test",
      body: rawBody,
      headers: { "content-type": "application/octet-stream" },
      method: "POST",
      url: "/v1/auth/raw-fixture",
    });

    expect(Buffer.from(await request.arrayBuffer())).toEqual(rawBody);
  });
});
