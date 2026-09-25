import { parseApiConfig, type ApiConfig } from "@arquibancada-viva/config/api";
import {
  type MatchJoinResult,
  type MatchRealtimeEvent,
  type MatchSnapshot,
  matchRealtimeEventSchema,
  REALTIME_EVENT_CHANNEL,
  REALTIME_EVENT_VERSION,
  technicalActionResponseSchema,
} from "@arquibancada-viva/contracts";
import {
  createOutboxDispatcher,
  createPublicId,
  getOutboxMessage,
} from "@arquibancada-viva/database";
import {
  createEphemeralPostgresDatabase,
  type EphemeralPostgresDatabase,
} from "@arquibancada-viva/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import Redis from "ioredis";
import { io, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../../app.js";

const adminDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://app:app@127.0.0.1:5432/arquibancada_viva";
const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const trustedOrigin = "http://127.0.0.1:3000";

function config(databaseUrl: string): ApiConfig {
  return parseApiConfig({
    API_DATABASE_POOL_MAX: "4",
    API_HOST: "127.0.0.1",
    API_PORT: "3001",
    AUTH_BASE_URL: "http://127.0.0.1:3001",
    AUTH_SECRET: "integration-only-auth-secret-32-characters",
    DATABASE_URL: databaseUrl,
    LOG_LEVEL: "warn",
    NODE_ENV: "test",
    RATE_LIMIT_AUTH_MAX: "100",
    RATE_LIMIT_GENERAL_MAX: "1000",
    RATE_LIMIT_MUTATION_MAX: "1000",
    REDIS_URL: redisUrl,
    S3_ACCESS_KEY_ID: "integration-access",
    S3_BUCKET: "integration-bucket",
    S3_ENDPOINT: "http://127.0.0.1:9000",
    S3_FORCE_PATH_STYLE: "true",
    S3_REGION: "us-east-1",
    S3_SECRET_ACCESS_KEY: "integration-only-storage-secret-32-characters",
    TECHNICAL_HARNESS_ENABLED: "true",
    WEB_ORIGIN: trustedOrigin,
  });
}

async function listen(application: NestFastifyApplication): Promise<string> {
  await application.listen(0, "127.0.0.1");
  const address = application.getHttpServer().address();
  if (!address || typeof address === "string") {
    throw new Error("API de teste sem endereço TCP.");
  }
  return `http://127.0.0.1:${address.port}`;
}

function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}

function connectMatchSocket(baseURL: string, cookie: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(`${baseURL}/matches`, {
      autoConnect: false,
      extraHeaders: { Cookie: cookie, Origin: trustedOrigin },
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
    });
    const timer = setTimeout(() => reject(new Error("SOCKET_CONNECT_TIMEOUT")), 5_000);
    socket.once("connect_error", reject);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.connect();
  });
}

function joinMatch(socket: Socket, matchId: string): Promise<MatchJoinResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("MATCH_JOIN_TIMEOUT")), 5_000);
    socket.emit("match:join", { matchId }, (result: MatchJoinResult) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

function matchingEvent(socket: Socket, eventId: string): Promise<MatchRealtimeEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("MATCH_EVENT_TIMEOUT")), 5_000);
    const listener = (payload: unknown) => {
      const parsed = matchRealtimeEventSchema.safeParse(payload);
      if (parsed.success && parsed.data.eventId === eventId) {
        clearTimeout(timer);
        socket.off("match:event.v1", listener);
        resolve(parsed.data);
      }
    };
    socket.on("match:event.v1", listener);
  });
}

function nextSnapshot(socket: Socket): Promise<MatchSnapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("MATCH_SNAPSHOT_TIMEOUT")), 5_000);
    socket.once("match:snapshot.v1", (snapshot: MatchSnapshot) => {
      clearTimeout(timer);
      resolve(snapshot);
    });
  });
}

async function submitAction(input: {
  readonly baseURL: string;
  readonly cookie: string;
  readonly idempotencyKey: string;
  readonly matchId: string;
}) {
  const response = await fetch(`${input.baseURL}/v1/technical/matches/${input.matchId}/actions`, {
    body: JSON.stringify({ action: "battery", version: 1 }),
    headers: {
      "content-type": "application/json",
      cookie: input.cookie,
      "idempotency-key": input.idempotencyKey,
      origin: trustedOrigin,
    },
    method: "POST",
  });
  expect(response.status).toBe(202);
  return technicalActionResponseSchema.parse(await response.json());
}

describe("technical foundation integration harness", () => {
  let database: EphemeralPostgresDatabase;
  let application: NestFastifyApplication;
  let baseURL: string;
  let cookie: string;
  let redis: Redis;

  beforeAll(async () => {
    database = await createEphemeralPostgresDatabase({
      adminDatabaseUrl,
      prefix: "av_tft016",
    });
    redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await redis.connect();
    application = await createApiApplication(config(database.url), { logger: false });
    baseURL = await listen(application);
    const signUp = await fetch(`${baseURL}/v1/auth/sign-up/email`, {
      body: JSON.stringify({
        email: `tft016-${Date.now()}@example.test`,
        name: "TFT-016 fixture",
        password: "Strong-password-42",
      }),
      headers: { "content-type": "application/json", origin: trustedOrigin },
      method: "POST",
    });
    expect(signUp.status).toBe(200);
    cookie = cookieHeader(signUp);
  }, 20_000);

  afterAll(async () => {
    await Promise.allSettled([application?.close(), redis?.quit()]);
    await database?.close();
  });

  it("keeps confirmed effects through API and publisher restarts", async () => {
    const matchId = createPublicId();
    const seed = await submitAction({
      baseURL,
      cookie,
      idempotencyKey: `seed-${createPublicId()}`,
      matchId,
    });
    const socket = await connectMatchSocket(baseURL, cookie);
    expect(await joinMatch(socket, matchId)).toMatchObject({
      latestSequence: 1,
      ok: true,
      sync: "snapshot",
    });

    const commandKey = `command-${createPublicId()}`;
    const command = await submitAction({ baseURL, cookie, idempotencyKey: commandKey, matchId });
    const eventPromise = matchingEvent(socket, command.eventId);
    const dispatcher = createOutboxDispatcher(database.database, {
      publisher: {
        async publish(message) {
          await redis.publish(
            REALTIME_EVENT_CHANNEL,
            JSON.stringify(
              matchRealtimeEventSchema.parse({
                eventId: message.eventId,
                eventType: message.eventType,
                matchId: message.aggregateId,
                occurredAt: message.occurredAt.toISOString(),
                payload: message.payload,
                sequence: Number(message.sequence),
                version: REALTIME_EVENT_VERSION,
              }),
            ),
          );
        },
      },
    });
    expect(await dispatcher.dispatchBatch(10)).toMatchObject({ published: 2 });
    expect(await eventPromise).toMatchObject({ eventId: command.eventId, sequence: 2 });

    const replay = await submitAction({
      baseURL,
      cookie,
      idempotencyKey: commandKey,
      matchId,
    });
    expect(replay).toMatchObject({ eventId: command.eventId, replayed: true, sequence: 2 });
    expect((await getOutboxMessage(database.database, seed.eventId))?.status).toBe("published");
    socket.close();

    await application.close();
    application = await createApiApplication(config(database.url), { logger: false });
    baseURL = await listen(application);
    const restartedSocket = await connectMatchSocket(baseURL, cookie);
    const restartedSnapshot = nextSnapshot(restartedSocket);
    expect(await joinMatch(restartedSocket, matchId)).toMatchObject({
      latestSequence: 2,
      ok: true,
      sync: "snapshot",
    });
    expect(await restartedSnapshot).toMatchObject({ projection: { battery: 2 } });

    const pending = await submitAction({
      baseURL,
      cookie,
      idempotencyKey: `after-restart-${createPublicId()}`,
      matchId,
    });
    await redis.quit();
    redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
    const restartedEvent = matchingEvent(restartedSocket, pending.eventId);
    const recoveredDispatcher = createOutboxDispatcher(database.database, {
      publisher: {
        async publish(message) {
          await redis.publish(
            REALTIME_EVENT_CHANNEL,
            JSON.stringify({
              eventId: message.eventId,
              eventType: message.eventType,
              matchId: message.aggregateId,
              occurredAt: message.occurredAt.toISOString(),
              payload: message.payload,
              sequence: Number(message.sequence),
              version: REALTIME_EVENT_VERSION,
            }),
          );
        },
      },
    });
    expect(await recoveredDispatcher.dispatchBatch(10)).toMatchObject({ published: 1 });
    expect(await restartedEvent).toMatchObject({ eventId: pending.eventId, sequence: 3 });
    expect((await getOutboxMessage(database.database, pending.eventId))?.status).toBe("published");
    restartedSocket.close();
  }, 20_000);
});
