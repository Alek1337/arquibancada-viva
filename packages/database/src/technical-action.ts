import { createHash } from "node:crypto";
import { executeIdempotentCommand, type JsonObject } from "./idempotency.js";
import { createPublicId } from "./identifiers.js";
import { recordOutboxMessage } from "./outbox.js";
import type { Database } from "./pool.js";
import { nextMatchSequence } from "./transactions.js";

export interface TechnicalActionCommandValue extends JsonObject {
  readonly committedAt: string;
  readonly eventId: string;
  readonly matchId: string;
  readonly sequence: number;
}

export interface ExecuteTechnicalActionInput {
  readonly action: "battery" | "fireworks" | "flag" | "mosaic";
  readonly correlationId?: string;
  readonly database: Database;
  readonly idempotencyKey: string;
  readonly matchId: string;
  readonly now?: Date;
  readonly userId: string;
}

function identityScope(userId: string, matchId: string): string {
  const identityHash = createHash("sha256").update(userId, "utf8").digest("hex").slice(0, 16);
  return `technical-action:${matchId}:${identityHash}`;
}

export async function executeTechnicalAction(input: ExecuteTechnicalActionInput) {
  const now = input.now ?? new Date();
  return executeIdempotentCommand<TechnicalActionCommandValue>(input.database, {
    key: input.idempotencyKey,
    now,
    operation: async (transaction) => {
      const eventId = createPublicId(now.getTime());
      const sequence = await nextMatchSequence(transaction, input.matchId);
      const numericSequence = Number(sequence);
      await recordOutboxMessage(transaction, {
        aggregateId: input.matchId,
        aggregateType: "match",
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
        eventId,
        eventType: "technical.action-accepted",
        eventVersion: 1,
        occurredAt: now,
        payload: {
          action: input.action,
          [input.action]: numericSequence,
          technical: true,
        },
        sequence,
      });
      return {
        committedAt: now.toISOString(),
        eventId,
        matchId: input.matchId,
        sequence: numericSequence,
      };
    },
    request: { action: input.action, matchId: input.matchId, version: 1 },
    scope: identityScope(input.userId, input.matchId),
  });
}
