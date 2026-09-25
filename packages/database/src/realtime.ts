import { and, asc, eq, gt, lte } from "drizzle-orm";
import type { JsonObject } from "./idempotency.js";
import type { Database } from "./pool.js";
import { matchSequences, outboxMessages } from "./schema/index.js";

export interface RealtimeMatchState {
  readonly latestSequence: number;
  readonly matchId: string;
  readonly updatedAt: Date;
}

export interface PersistedRealtimeEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly matchId: string;
  readonly occurredAt: Date;
  readonly payload: JsonObject;
  readonly sequence: number;
}

const MAX_FOUNDATION_PROJECTION_EVENTS = 5_000;

export async function getRealtimeMatchProjection(
  database: Database,
  input: { readonly latestSequence: number; readonly matchId: string },
): Promise<JsonObject> {
  if (!Number.isSafeInteger(input.latestSequence) || input.latestSequence < 0) {
    throw new RangeError("latestSequence deve ser um inteiro seguro não negativo.");
  }
  const rows = await database
    .select({ payload: outboxMessages.payload })
    .from(outboxMessages)
    .where(
      and(
        eq(outboxMessages.aggregateType, "match"),
        eq(outboxMessages.aggregateId, input.matchId),
        lte(outboxMessages.sequence, BigInt(input.latestSequence)),
      ),
    )
    .orderBy(asc(outboxMessages.sequence))
    .limit(MAX_FOUNDATION_PROJECTION_EVENTS + 1);
  if (rows.length > MAX_FOUNDATION_PROJECTION_EVENTS) {
    throw new RangeError("A projeção técnica excedeu o limite da fundação.");
  }
  return Object.assign({}, ...rows.map((row) => row.payload as JsonObject)) as JsonObject;
}

function safeSequence(value: bigint): number {
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new RangeError("A sequence persistida não cabe em um inteiro seguro.");
  }
  return sequence;
}

export async function getRealtimeMatchState(
  database: Database,
  matchId: string,
): Promise<RealtimeMatchState | undefined> {
  const [state] = await database
    .select()
    .from(matchSequences)
    .where(eq(matchSequences.matchId, matchId))
    .limit(1);
  if (!state) {
    return undefined;
  }
  return {
    latestSequence: safeSequence(state.lastSequence),
    matchId: state.matchId,
    updatedAt: state.updatedAt,
  };
}

export async function getRealtimeEventsAfter(
  database: Database,
  input: { readonly limit: number; readonly matchId: string; readonly sequence: number },
): Promise<PersistedRealtimeEvent[]> {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) {
    throw new RangeError("sequence deve ser um inteiro seguro não negativo.");
  }
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 501) {
    throw new RangeError("limit deve ser um inteiro entre 1 e 501.");
  }

  const rows = await database
    .select({
      eventId: outboxMessages.eventId,
      eventType: outboxMessages.eventType,
      eventVersion: outboxMessages.eventVersion,
      matchId: outboxMessages.aggregateId,
      occurredAt: outboxMessages.occurredAt,
      payload: outboxMessages.payload,
      sequence: outboxMessages.sequence,
    })
    .from(outboxMessages)
    .where(
      and(
        eq(outboxMessages.aggregateType, "match"),
        eq(outboxMessages.aggregateId, input.matchId),
        gt(outboxMessages.sequence, BigInt(input.sequence)),
      ),
    )
    .orderBy(asc(outboxMessages.sequence))
    .limit(input.limit);

  return rows.map((row) => ({
    ...row,
    payload: row.payload as JsonObject,
    sequence: safeSequence(row.sequence),
  }));
}
