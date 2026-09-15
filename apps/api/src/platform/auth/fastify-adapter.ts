import {
  type AuthRuntime,
  createAuthRequestLog,
  createAuthWebRequest,
} from "@arquibancada-viva/auth";
import type { ApiConfig } from "@arquibancada-viva/config/api";
import fastifyCors from "@fastify/cors";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

async function forwardAuthResponse(response: Response, reply: FastifyReply) {
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

export function mountAuthFastify(
  fastify: FastifyInstance,
  auth: AuthRuntime,
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
        const authRequest = createAuthWebRequest({
          baseURL: config.AUTH_BASE_URL,
          body: request.body,
          headers: request.headers,
          method: request.method,
          url: request.url,
        });
        const response = await auth.handle(authRequest);
        request.log.info(
          createAuthRequestLog({
            method: request.method,
            statusCode: response.status,
            url: request.url,
          }),
        );
        return await forwardAuthResponse(response, reply);
      } catch (error) {
        request.log.error(
          createAuthRequestLog({ error, method: request.method, url: request.url }),
        );
        return reply.status(500).send({ code: "AUTH_FAILURE", message: "Authentication failed" });
      }
    },
    method: ["GET", "POST"],
    url: "/v1/auth/*",
  });

  fastify.get("/v1/me/session", async (request, reply) => {
    const identity = await auth.resolveIdentity(request.headers);
    if (!identity) {
      return reply.status(401).send({ code: "UNAUTHORIZED", message: "Authentication required" });
    }
    return reply.send(identity);
  });
}
