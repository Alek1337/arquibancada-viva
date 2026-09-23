import { describe, expect, it } from "vitest";
import { toAuthIdentity } from "./identity.js";
import { createAuthWebRequest } from "./request.js";
import { createAuthRequestLog, redactAuthLogValue, redactLogValue } from "./redaction.js";

describe("shared auth foundation", () => {
  it("exposes only stable identity primitives", () => {
    const providerSession = {
      account: { providerId: "external-provider", providerUserId: "provider-user" },
      session: { id: "session-id" },
      user: { email: "private@example.test", id: "user-id" },
    };
    const identity = toAuthIdentity(providerSession);

    expect(identity).toEqual({ sessionId: "session-id", userId: "user-id" });
    expect(Object.keys(identity).sort()).toEqual(["sessionId", "userId"]);
  });

  it("serializes parsed JSON exactly once", async () => {
    const request = createAuthWebRequest({
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

  it("preserves raw byte bodies supplied by a platform parser", async () => {
    const rawBody = Buffer.from([0, 1, 2, 127, 128, 255]);
    const request = createAuthWebRequest({
      baseURL: "https://api.example.test",
      body: rawBody,
      headers: { "content-type": "application/octet-stream" },
      method: "POST",
      url: "/v1/auth/raw-fixture",
    });

    expect(Buffer.from(await request.arrayBuffer())).toEqual(rawBody);
  });

  it("redacts cookies, tokens, passwords and secrets from nested log data", () => {
    const sensitiveValues = [
      "Bearer sentinel-authorization",
      "session=sentinel-cookie",
      "sentinel-password",
      "sentinel-access-token",
      "sentinel-refresh-token",
      "sentinel-secret",
      "private@example.test",
    ];
    const output = JSON.stringify(
      redactAuthLogValue({
        body: {
          accessToken: sensitiveValues[3],
          email: sensitiveValues[6],
          nested: { refresh_token: sensitiveValues[4] },
          password: sensitiveValues[2],
        },
        headers: {
          authorization: sensitiveValues[0],
          cookie: sensitiveValues[1],
        },
        secret: sensitiveValues[5],
      }),
    );

    for (const sensitiveValue of sensitiveValues) {
      expect(output).not.toContain(sensitiveValue);
    }
    expect(output.match(/\[REDACTED\]/gu)?.length).toBe(7);
  });

  it("produces safe success and failure log events", () => {
    const secretInError = new Error("Bearer must-not-appear");
    const success = JSON.stringify(
      createAuthRequestLog({ method: "POST", statusCode: 200, url: "/v1/auth/sign-in/email" }),
    );
    const failure = JSON.stringify(
      createAuthRequestLog({
        error: secretInError,
        method: "POST",
        url: "/v1/auth/sign-in/email?token=query-token-must-not-appear",
      }),
    );

    expect(success).toContain("auth.request_completed");
    expect(failure).toContain("auth.request_failed");
    expect(failure).toContain("Error");
    expect(failure).not.toContain("must-not-appear");
    expect(failure).not.toContain("query-token-must-not-appear");
  });

  it("redacts S3 credentials and signed URLs in generic logs", () => {
    const output = JSON.stringify(
      redactLogValue({
        S3_ACCESS_KEY_ID: "must-not-appear-access",
        nested: { secret_access_key: "must-not-appear-secret" },
        url: "https://storage.example.test/object?X-Amz-Signature=must-not-appear-signature",
      }),
    );

    expect(output).not.toContain("must-not-appear");
    expect(output.match(/\[REDACTED\]/gu)?.length).toBe(3);
  });
});
