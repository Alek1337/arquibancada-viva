import { parseApiConfig, type ApiConfig } from "@arquibancada-viva/config/api";
import {
  applyMigrations,
  createMigrationDatabase,
  type DatabaseRuntime,
} from "@arquibancada-viva/database";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { io, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../../app.js";

const adminDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://app:app@127.0.0.1:5432/arquibancada_viva";
const trustedOrigin = "https://web.example.test";
const testRun = `${process.pid}_${Date.now().toString(36)}`.toLowerCase();
const databaseName = `av_tft007_auth_${testRun}`;

function quoteDatabaseName(value: string): string {
  if (!/^[a-z0-9_]+$/u.test(value)) {
    throw new Error("Nome inseguro para banco temporário.");
  }
  return `"${value}"`;
}

function databaseUrl(value: string): string {
  const url = new URL(adminDatabaseUrl);
  url.pathname = `/${value}`;
  return url.toString();
}

function buildConfig(): ApiConfig {
  return parseApiConfig({
    API_DATABASE_POOL_MAX: "4",
    API_HOST: "127.0.0.1",
    API_PORT: "3001",
    AUTH_BASE_URL: "https://api.example.test",
    AUTH_SECRET: "integration-only-auth-secret-32-characters",
    DATABASE_URL: databaseUrl(databaseName),
    LOG_LEVEL: "fatal",
    NODE_ENV: "production",
    REDIS_URL: "redis://127.0.0.1:6379",
    S3_ACCESS_KEY_ID: "integration-access",
    S3_BUCKET: "integration-bucket",
    S3_ENDPOINT: "http://127.0.0.1:9000",
    S3_REGION: "us-east-1",
    S3_SECRET_ACCESS_KEY: "integration-only-storage-secret-32-characters",
    WEB_ORIGIN: trustedOrigin,
  });
}

function cookieHeader(response: Response): { header: string; setCookies: string[] } {
  const setCookies = response.headers.getSetCookie();
  return {
    header: setCookies.map((cookie) => cookie.split(";", 1)[0]).join("; "),
    setCookies,
  };
}

function connectAuthenticatedSocket(
  baseURL: string,
  cookie: string,
): Promise<{
  readonly payload: { sessionId: string; userId: string };
  readonly socket: Socket;
}> {
  return new Promise((resolve, reject) => {
    const socket = io(`${baseURL}/auth-spike`, {
      autoConnect: false,
      extraHeaders: { Cookie: cookie, Origin: trustedOrigin },
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
    });
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Timeout no handshake Socket.IO autenticado."));
    }, 5_000);
    socket.once("connect_error", (error) => {
      clearTimeout(timeout);
      socket.close();
      reject(error);
    });
    socket.once("auth:session", (payload) => {
      clearTimeout(timeout);
      resolve({ payload, socket });
    });
    socket.connect();
  });
}

function expectRejectedSocket(baseURL: string, cookie: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = io(`${baseURL}/auth-spike`, {
      autoConnect: false,
      extraHeaders: { Cookie: cookie, Origin: trustedOrigin },
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
    });
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Socket revogado não foi rejeitado."));
    }, 5_000);
    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.close();
      reject(new Error("Socket conectou com sessão revogada."));
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timeout);
      expect(error.message).toBe("Authentication required");
      socket.close();
      resolve();
    });
    socket.connect();
  });
}

describe("Better Auth official Fastify spike", () => {
  const adminRuntime = createMigrationDatabase(adminDatabaseUrl);
  let migrationRuntime: DatabaseRuntime;
  let application: NestFastifyApplication;
  let baseURL: string;

  beforeAll(async () => {
    await adminRuntime.pool.query(`CREATE DATABASE ${quoteDatabaseName(databaseName)}`);
    migrationRuntime = createMigrationDatabase(databaseUrl(databaseName));
    await applyMigrations(migrationRuntime.database);

    application = await createApiApplication(buildConfig());
    await application.listen(0, "127.0.0.1");
    const address = application.getHttpServer().address();
    if (!address || typeof address === "string") {
      throw new Error("API de teste sem endereço TCP.");
    }
    baseURL = `http://127.0.0.1:${address.port}`;
  }, 20_000);

  afterAll(async () => {
    await Promise.allSettled([application?.close(), migrationRuntime?.close()]);
    await adminRuntime.pool.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [databaseName],
    );
    await adminRuntime.pool.query(`DROP DATABASE IF EXISTS ${quoteDatabaseName(databaseName)}`);
    await adminRuntime.close();
  });

  it("allows only the configured browser origin", async () => {
    const allowed = await fetch(`${baseURL}/v1/auth/get-session`, {
      headers: {
        "access-control-request-method": "GET",
        origin: trustedOrigin,
      },
      method: "OPTIONS",
    });
    const denied = await fetch(`${baseURL}/v1/auth/get-session`, {
      headers: {
        "access-control-request-method": "GET",
        origin: "https://evil.example.test",
      },
      method: "OPTIONS",
    });

    expect(allowed.headers.get("access-control-allow-origin")).toBe(trustedOrigin);
    expect(denied.status).toBe(403);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("shares one session with REST and Socket.IO, then rejects it after revocation", async () => {
    const email = `fixture-${testRun}@example.test`;
    const signUp = await fetch(`${baseURL}/v1/auth/sign-up/email`, {
      body: JSON.stringify({
        email,
        name: "Fixture TFT-007",
        password: "Strong-password-42",
      }),
      headers: { "content-type": "application/json", origin: trustedOrigin },
      method: "POST",
    });
    const cookies = cookieHeader(signUp);

    expect(signUp.status).toBe(200);
    expect(cookies.header).not.toBe("");
    expect(cookies.setCookies.join("; ")).toMatch(/HttpOnly/iu);
    expect(cookies.setCookies.join("; ")).toMatch(/Secure/iu);
    expect(cookies.setCookies.join("; ")).toMatch(/SameSite=Lax/iu);

    const sessionResponse = await fetch(`${baseURL}/v1/auth/get-session`, {
      headers: { cookie: cookies.header, origin: trustedOrigin },
    });
    const sessionPayload = (await sessionResponse.json()) as {
      session: { id: string };
      user: { id: string };
    };
    const protectedRest = await fetch(`${baseURL}/v1/auth-spike/session`, {
      headers: { cookie: cookies.header, origin: trustedOrigin },
    });
    const restPayload = await protectedRest.json();

    expect(sessionResponse.status).toBe(200);
    expect(protectedRest.status).toBe(200);
    expect(restPayload).toEqual({
      sessionId: sessionPayload.session.id,
      userId: sessionPayload.user.id,
    });

    const connected = await connectAuthenticatedSocket(baseURL, cookies.header);
    expect(connected.payload).toEqual(restPayload);
    connected.socket.close();

    const signOut = await fetch(`${baseURL}/v1/auth/sign-out`, {
      body: "{}",
      headers: {
        "content-type": "application/json",
        cookie: cookies.header,
        origin: trustedOrigin,
      },
      method: "POST",
    });
    expect(signOut.status).toBe(200);

    const revokedRest = await fetch(`${baseURL}/v1/auth-spike/session`, {
      headers: { cookie: cookies.header, origin: trustedOrigin },
    });
    expect(revokedRest.status).toBe(401);
    await expectRejectedSocket(baseURL, cookies.header);
  });

  it("rejects a state-changing request from an untrusted origin", async () => {
    const response = await fetch(`${baseURL}/v1/auth/sign-up/email`, {
      body: JSON.stringify({
        email: `evil-${testRun}@example.test`,
        name: "Untrusted fixture",
        password: "Strong-password-42",
      }),
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example.test",
      },
      method: "POST",
    });

    expect(response.status).toBe(403);
  });
});
