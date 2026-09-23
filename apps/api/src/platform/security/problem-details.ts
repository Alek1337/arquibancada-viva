import {
  problemDetailsSchema,
  type ProblemDetails,
  uuidV7Schema,
} from "@arquibancada-viva/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";

interface HttpErrorLike {
  readonly statusCode?: number;
}

function safeStatus(error: unknown): number {
  const candidate = (error as HttpErrorLike | null)?.statusCode;
  return typeof candidate === "number" && candidate >= 400 && candidate <= 599 ? candidate : 500;
}

export function createProblemDetails(status: number, correlationId?: string): ProblemDetails {
  const definitions: Record<
    number,
    { readonly code: ProblemDetails["code"]; readonly detail: string; readonly title: string }
  > = {
    400: {
      code: "VALIDATION_ERROR",
      detail: "The request could not be processed.",
      title: "Invalid request",
    },
    401: {
      code: "UNAUTHENTICATED",
      detail: "Authentication is required.",
      title: "Authentication required",
    },
    403: { code: "FORBIDDEN", detail: "Access is not allowed.", title: "Forbidden" },
    404: { code: "NOT_FOUND", detail: "The resource was not found.", title: "Not found" },
    409: {
      code: "CONFLICT",
      detail: "The request conflicts with current state.",
      title: "Conflict",
    },
    413: {
      code: "VALIDATION_ERROR",
      detail: "The request payload exceeds the allowed size.",
      title: "Payload too large",
    },
    429: {
      code: "RATE_LIMITED",
      detail: "Too many requests. Try again later.",
      title: "Rate limit exceeded",
    },
    503: {
      code: "INTERNAL_ERROR",
      detail: "The service is temporarily unavailable.",
      title: "Service unavailable",
    },
  };
  const normalizedStatus = status >= 400 && status <= 599 ? status : 500;
  const definition = definitions[normalizedStatus] ?? {
    code: "INTERNAL_ERROR" as const,
    detail: "An unexpected error occurred.",
    title: "Internal server error",
  };
  return problemDetailsSchema.parse({
    ...definition,
    ...(uuidV7Schema.safeParse(correlationId).success ? { correlationId } : {}),
    status: normalizedStatus,
    type: "about:blank",
  });
}

export function problemFromError(error: unknown, request: FastifyRequest): ProblemDetails {
  return createProblemDetails(safeStatus(error), request.id);
}

export function sendProblem(reply: FastifyReply, problem: ProblemDetails): FastifyReply {
  return reply.type("application/problem+json").status(problem.status).send(problem);
}
