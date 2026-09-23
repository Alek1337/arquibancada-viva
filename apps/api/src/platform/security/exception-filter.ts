import { Catch, type ArgumentsHost, type ExceptionFilter, HttpException } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createProblemDetails, sendProblem } from "./problem-details.js";

function readinessResponse(exception: unknown): Record<string, unknown> | undefined {
  if (!(exception instanceof HttpException)) {
    return undefined;
  }
  const response = exception.getResponse();
  if (
    typeof response === "object" &&
    response !== null &&
    "checks" in response &&
    "status" in response
  ) {
    return response as Record<string, unknown>;
  }
  return undefined;
}

@Catch()
export class SafeHttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const reply = context.getResponse<FastifyReply>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const safeReadiness = readinessResponse(exception);

    if (status >= 500) {
      request.log.error(
        { correlationId: request.id, error: exception, event: "http.request_failed" },
        "http.request_failed",
      );
    }
    if (safeReadiness) {
      reply.status(status).send(safeReadiness);
      return;
    }
    sendProblem(reply, createProblemDetails(status, request.id));
  }
}
