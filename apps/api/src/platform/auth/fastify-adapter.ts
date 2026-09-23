import {
  type AuthRuntime,
  createAuthRequestLog,
  createAuthWebRequest,
} from "@arquibancada-viva/auth";
import type { ApiConfig } from "@arquibancada-viva/config/api";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createProblemDetails, sendProblem } from "../security/problem-details.js";

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
        return sendProblem(reply, createProblemDetails(500, request.id));
      }
    },
    method: ["GET", "POST"],
    url: "/v1/auth/*",
  });

  fastify.get("/v1/me/session", async (request, reply) => {
    const identity = await auth.resolveIdentity(request.headers);
    if (!identity) {
      return sendProblem(reply, createProblemDetails(401, request.id));
    }
    return reply.send(identity);
  });
}
