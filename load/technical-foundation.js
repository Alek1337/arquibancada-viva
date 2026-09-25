import http from "k6/http";
import ws from "k6/ws";
import { check, fail, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

const apiUrl = __ENV.TARGET_API_URL || "http://127.0.0.1:3001";
const webOrigin = __ENV.TARGET_WEB_ORIGIN || "http://127.0.0.1:3000";
const socketUrl = apiUrl.replace(/^http/u, "ws");
const cooldownMs = Number(__ENV.TECHNICAL_COOLDOWN_MS || 3000);
const activeMs = Number(__ENV.LOAD_ACTIVE_MS || 22000);
const virtualUsers = 20;

const actionResponse = new Trend("technical_action_response_ms", true);
const eventPropagation = new Trend("technical_event_propagation_ms", true);
const confirmedWithoutEvent = new Counter("technical_confirmed_without_event");
const commandFailures = new Counter("technical_command_failures");

export const options = {
  scenarios: {
    technical_foundation: {
      executor: "per-vu-iterations",
      iterations: 1,
      maxDuration: __ENV.LOAD_DURATION || "30s",
      vus: virtualUsers,
    },
  },
  thresholds: {
    checks: ["rate>0.99"],
    technical_action_response_ms: ["p(95)<500"],
    technical_command_failures: ["count==0"],
    technical_confirmed_without_event: ["count==0"],
    technical_event_propagation_ms: ["p(95)<1000"],
  },
};

function testId(label) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}-${__VU}-${__ITER}`;
}

function cookieHeader(response) {
  const pairs = [];
  for (const [name, cookies] of Object.entries(response.cookies)) {
    for (const cookie of cookies) {
      pairs.push(`${name}=${cookie.value}`);
    }
  }
  return pairs.join("; ");
}

function requestHeaders(cookie, idempotencyKey) {
  return {
    Cookie: cookie,
    Origin: webOrigin,
    "content-type": "application/json",
    ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
  };
}

export function setup() {
  if (!/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/u.test(apiUrl)) {
    fail(`TARGET_API_URL must be loopback for the foundation harness: ${apiUrl}`);
  }
  const run = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const sessions = [];
  for (let index = 0; index < virtualUsers; index += 1) {
    const response = http.post(
      `${apiUrl}/v1/auth/sign-up/email`,
      JSON.stringify({
        email: `k6-${run}-${index}@example.test`,
        name: `k6 player ${index + 1}`,
        password: "Strong-password-42",
      }),
      { headers: requestHeaders("") },
    );
    if (response.status !== 200) {
      fail(`Could not create load session ${index + 1}: ${response.status}`);
    }
    sessions.push(cookieHeader(response));
  }

  const matchIdResponse = http.get(`${apiUrl}/v1/health`);
  check(matchIdResponse, { "API is alive before load": (response) => response.status === 200 });
  const matchId = __ENV.TECHNICAL_MATCH_ID;
  if (!matchId) {
    fail("TECHNICAL_MATCH_ID must be a seeded UUIDv7 from pnpm test:load:seed");
  }
  const seed = http.post(
    `${apiUrl}/v1/technical/matches/${matchId}/actions`,
    JSON.stringify({ action: "battery", version: 1 }),
    { headers: requestHeaders(sessions[0], `k6-seed-${run}`) },
  );
  if (seed.status !== 202) {
    fail(`Could not seed technical match: ${seed.status}`);
  }
  return { matchId, sessions };
}

export default function (data) {
  const cookie = data.sessions[__VU - 1];
  const outstanding = new Map();
  let joined = false;
  let stopped = false;
  const response = ws.connect(
    `${socketUrl}/socket.io/?EIO=4&transport=websocket`,
    { headers: { Cookie: cookie, Origin: webOrigin } },
    (socket) => {
      socket.on("message", (raw) => {
        const message = String(raw);
        if (message.startsWith("0")) {
          socket.send("40/matches,");
          return;
        }
        if (message === "2") {
          socket.send("3");
          return;
        }
        if (message.startsWith("40/matches,")) {
          socket.send(`42/matches,1["match:join",{"matchId":"${data.matchId}"}]`);
          return;
        }
        if (message.startsWith("43/matches,1")) {
          joined = true;
          return;
        }
        if (!message.startsWith("42/matches,")) {
          return;
        }
        const packet = JSON.parse(message.slice(message.indexOf(",") + 1));
        if (packet[0] !== "match:event.v1") {
          return;
        }
        const event = packet[1];
        const committedAt = outstanding.get(event.eventId);
        if (committedAt !== undefined) {
          eventPropagation.add(Date.now() - committedAt);
          outstanding.delete(event.eventId);
        }
      });

      const submitAction = () => {
        if (!joined || stopped) {
          return;
        }
        const idempotencyKey = testId("k6-action");
        const action = http.post(
          `${apiUrl}/v1/technical/matches/${data.matchId}/actions`,
          JSON.stringify({ action: "battery", version: 1 }),
          { headers: requestHeaders(cookie, idempotencyKey) },
        );
        actionResponse.add(action.timings.duration);
        if (action.status !== 202) {
          commandFailures.add(1);
          return;
        }
        const body = action.json();
        outstanding.set(body.eventId, Date.parse(body.committedAt));
      };
      const actionOffsetMs = Math.max(1, Math.floor(((__VU - 1) * cooldownMs) / virtualUsers));
      socket.setTimeout(() => {
        submitAction();
        socket.setInterval(submitAction, cooldownMs);
      }, actionOffsetMs);

      socket.setTimeout(
        () => {
          stopped = true;
        },
        Math.max(1000, activeMs - 2000),
      );
      socket.setTimeout(() => {
        confirmedWithoutEvent.add(outstanding.size);
        socket.close();
      }, activeMs);
    },
  );

  check(response, { "Socket.IO transport upgraded": (result) => result?.status === 101 });
  sleep(0.1);
}
