import type { ApiConfig } from "@arquibancada-viva/config/api";
import fastifyCors from "@fastify/cors";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { IncomingHttpHeaders } from "node:http";
import type { BetterAuthSpike } from "./auth.js";
import { resolveBetterAuthSession } from "./session.js";

interface BetterAuthRequestInput {
  readonly baseURL: string;
  readonly body: unknown;
  readonly headers: IncomingHttpHeaders;
  readonly method: string;
  readonly url: string;
}

function requestBody(body: unknown) {
  if (body === undefined || body === null) {
    return undefined;
  }
  if (typeof body === "string" || body instanceof Uint8Array) {
    return body;
  }
  return JSON.stringify(body);
}

export function createBetterAuthWebRequest(input: BetterAuthRequestInput): Request {
  const body = requestBody(input.body);
  return new Request(new URL(input.url, input.baseURL), {
    method: input.method,
    headers: fromNodeHeaders(input.headers),
    ...(body === undefined ? {} : { body }),
  });
}

async function forwardBetterAuthResponse(response: Response, reply: FastifyReply) {
  reply.status(response.status);
  const setCookies = response.headers.getSetCookie();
  response.headers.forEach((value, key) => {
    if (key !== "set-cookie") {
      reply.header(key, value);
    }
  });
  if (setCookies.length > 0) {
    reply.header("set-cookie", setCookies);
  }
  return reply.send(response.body ? await response.text() : null);
}

export function mountBetterAuthFastify(
  fastify: FastifyInstance,
  auth: BetterAuthSpike,
  config: ApiConfig,
): void {
  fastify.register(fastifyCors, {
    allowedHeaders: ["content-type", "authorization", "x-requested-with"],
    credentials: true,
    maxAge: 86_400,
    methods: ["GET", "POST", "OPTIONS"],
    origin(origin, callback) {
      callback(null, origin === undefined || origin === config.WEB_ORIGIN);
    },
  });

  fastify.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== config.WEB_ORIGIN) {
      return reply.status(403).send({
        code: "ORIGIN_NOT_ALLOWED",
        message: "Request origin is not allowed",
      });
    }
  });

  fastify.route({
    async handler(request: FastifyRequest, reply: FastifyReply) {
      try {
        const authRequest = createBetterAuthWebRequest({
          baseURL: config.AUTH_BASE_URL,
          body: request.body,
          headers: request.headers,
          method: request.method,
          url: request.url,
        });
        return await forwardBetterAuthResponse(await auth.handler(authRequest), reply);
      } catch (error) {
        request.log.error({
          error: error instanceof Error ? { message: error.message, name: error.name } : {},
          event: "auth.handler_failed",
        });
        return reply.status(500).send({ code: "AUTH_FAILURE", message: "Authentication failed" });
      }
    },
    method: ["GET", "POST"],
    url: "/v1/auth/*",
  });

  fastify.get("/v1/auth-spike/session", async (request, reply) => {
    const session = await resolveBetterAuthSession(auth, request.headers);
    if (!session) {
      return reply.status(401).send({ code: "UNAUTHORIZED", message: "Authentication required" });
    }
    return reply.send({
      sessionId: session.session.id,
      userId: session.user.id,
    });
  });
}
