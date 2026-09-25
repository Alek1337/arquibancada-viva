import type { AuthRuntime } from "@arquibancada-viva/auth";
import {
  technicalActionRequestSchema,
  technicalActionResponseSchema,
  uuidV7Schema,
} from "@arquibancada-viva/contracts";
import {
  executeTechnicalAction,
  IdempotencyConflictError,
  IdempotencyStateError,
  type Database,
} from "@arquibancada-viva/database";
import type { FastifyInstance } from "fastify";
import { createProblemDetails, sendProblem } from "../security/problem-details.js";

interface TechnicalActionParams {
  readonly matchId: string;
}

function idempotencyKey(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length >= 8 && value.length <= 200 ? value : undefined;
}

export function mountTechnicalHarness(
  fastify: FastifyInstance,
  auth: AuthRuntime,
  database: Database,
): void {
  fastify.post<{ Params: TechnicalActionParams }>(
    "/v1/technical/matches/:matchId/actions",
    async (request, reply) => {
      const identity = await auth.resolveIdentity(request.headers);
      if (!identity) {
        return sendProblem(reply, createProblemDetails(401, request.id));
      }
      const matchId = uuidV7Schema.safeParse(request.params.matchId);
      const body = technicalActionRequestSchema.safeParse(request.body);
      const key = idempotencyKey(request.headers["idempotency-key"]);
      if (!matchId.success || !body.success || !key) {
        return sendProblem(reply, createProblemDetails(400, request.id));
      }

      try {
        const result = await executeTechnicalAction({
          action: body.data.action,
          correlationId: request.id,
          database,
          idempotencyKey: key,
          matchId: matchId.data,
          userId: identity.userId,
        });
        return reply.status(202).send(
          technicalActionResponseSchema.parse({
            accepted: true,
            ...result.value,
            replayed: result.replayed,
          }),
        );
      } catch (error) {
        if (error instanceof IdempotencyConflictError) {
          return sendProblem(reply, createProblemDetails(409, request.id));
        }
        if (error instanceof IdempotencyStateError) {
          return sendProblem(reply, createProblemDetails(503, request.id));
        }
        throw error;
      }
    },
  );
}
