import type { ApiConfig } from "@arquibancada-viva/config/api";
import {
  noopObservability,
  type Observability,
  type SpanHandle,
} from "@arquibancada-viva/observability";
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RateLimitGuard } from "./rate-limit.js";
import { createProblemDetails, problemFromError, sendProblem } from "./problem-details.js";

interface RatePolicy {
  readonly failClosed: boolean;
  readonly limit: number;
  readonly scope: "auth-mutation" | "general" | "mutation";
}

interface HttpSecurityOptions {
  readonly installErrorHandler?: boolean;
  readonly observability?: Observability;
}

function isMutation(method: string): boolean {
  return !new Set(["GET", "HEAD", "OPTIONS"]).has(method);
}

function ratePolicy(request: FastifyRequest, config: ApiConfig): RatePolicy | undefined {
  const path = request.url.split("?", 1)[0] ?? "/";
  if (request.method === "OPTIONS" || path === "/v1/health" || path === "/v1/ready") {
    return undefined;
  }
  if (path.startsWith("/v1/auth/") && isMutation(request.method)) {
    return { failClosed: true, limit: config.RATE_LIMIT_AUTH_MAX, scope: "auth-mutation" };
  }
  if (isMutation(request.method)) {
    return { failClosed: true, limit: config.RATE_LIMIT_MUTATION_MAX, scope: "mutation" };
  }
  return { failClosed: false, limit: config.RATE_LIMIT_GENERAL_MAX, scope: "general" };
}

function applyRateHeaders(reply: FastifyReply, limit: number, remaining: number): void {
  reply.header("x-ratelimit-limit", limit);
  reply.header("x-ratelimit-remaining", remaining);
}

export function mountHttpSecurity(
  fastify: FastifyInstance,
  config: ApiConfig,
  rateLimit?: RateLimitGuard,
  options: HttpSecurityOptions = {},
): void {
  const observability = options.observability ?? noopObservability;
  const requestSpans = new WeakMap<
    FastifyRequest,
    { readonly startedAt: number; readonly span: SpanHandle }
  >();
  fastify.register(fastifyCors, {
    allowedHeaders: ["authorization", "content-type", "idempotency-key", "x-requested-with"],
    credentials: true,
    exposedHeaders: [
      "retry-after",
      "x-correlation-id",
      "x-ratelimit-limit",
      "x-ratelimit-remaining",
    ],
    maxAge: 86_400,
    methods: ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"],
    origin(origin, callback) {
      callback(null, origin === undefined || origin === config.WEB_ORIGIN);
    },
  });
  fastify.register(fastifyHelmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    global: true,
    strictTransportSecurity:
      config.NODE_ENV === "production" ? { includeSubDomains: true, maxAge: 31_536_000 } : false,
  });

  fastify.addHook("onRequest", async (request, reply) => {
    requestSpans.set(request, {
      span: observability.startSpan("http.request", {
        correlationId: request.id,
        method: request.method,
        route: request.url.split("?", 1)[0] ?? "/",
      }),
      startedAt: performance.now(),
    });
    reply.header("x-correlation-id", request.id);
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== config.WEB_ORIGIN) {
      sendProblem(reply, createProblemDetails(403, request.id));
      return;
    }
    if (!rateLimit) {
      return;
    }
    const policy = ratePolicy(request, config);
    if (!policy) {
      return;
    }
    try {
      const decision = await rateLimit.consume({
        identity: request.ip,
        limit: policy.limit,
        scope: policy.scope,
      });
      applyRateHeaders(reply, decision.limit, decision.remaining);
      if (!decision.allowed) {
        reply.header("retry-after", decision.retryAfterSeconds);
        sendProblem(reply, createProblemDetails(429, request.id));
        return;
      }
    } catch {
      if (policy.failClosed) {
        reply.header("retry-after", 1);
        sendProblem(reply, createProblemDetails(503, request.id));
        return;
      }
      request.log.warn(
        { correlationId: request.id, event: "rate_limit.degraded", scope: policy.scope },
        "rate_limit.degraded",
      );
    }
  });

  fastify.addHook("onResponse", async (request, reply) => {
    const active = requestSpans.get(request);
    if (!active) {
      return;
    }
    observability.recordHttp(performance.now() - active.startedAt, {
      correlationId: request.id,
      method: request.method,
      route: request.url.split("?", 1)[0] ?? "/",
      statusCode: reply.statusCode,
    });
    if (reply.statusCode >= 500) {
      active.span.fail("HTTP_SERVER_ERROR");
    }
    active.span.end();
    requestSpans.delete(request);
  });

  if (options.installErrorHandler !== false) {
    fastify.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
      observability.captureException("HTTP_REQUEST_FAILED", {
        correlationId: request.id,
        method: request.method,
        route: request.url.split("?", 1)[0] ?? "/",
        statusCode: error.statusCode ?? 500,
      });
      request.log.error(
        { correlationId: request.id, error, event: "http.request_failed" },
        "http.request_failed",
      );
      sendProblem(reply, problemFromError(error, request));
    });
  }
}
