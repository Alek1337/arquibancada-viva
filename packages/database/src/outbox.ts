import { and, eq, sql } from "drizzle-orm";
import type { JsonObject } from "./idempotency.js";
import type { Database } from "./pool.js";
import { outboxMessages } from "./schema/index.js";
import { type DatabaseTransaction, withTransaction } from "./transactions.js";

export interface OutboxMessageInput {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly correlationId?: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly occurredAt: Date;
  readonly payload: JsonObject;
  readonly sequence: bigint;
}

export interface OutboxMessage extends OutboxMessageInput {
  readonly attempts: number;
}

export interface OutboxPublisher {
  publish(message: OutboxMessage): Promise<void>;
}

export interface OutboxDispatcher {
  dispatchBatch(limit?: number): Promise<OutboxDispatchSummary>;
  dispatchNow(eventId: string): Promise<"deferred" | "published" | "unavailable">;
}

export interface OutboxDispatchSummary {
  readonly claimed: number;
  readonly deferred: number;
  readonly published: number;
}

export interface OutboxDispatcherOptions {
  readonly clock?: () => Date;
  readonly leaseMs?: number;
  readonly maximumAttempts?: number;
  readonly publisher: OutboxPublisher;
  readonly retryBaseMs?: number;
  readonly retryMaximumMs?: number;
}

interface ClaimedOutboxRow extends Record<string, unknown> {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly attempts: number;
  readonly correlationId: null | string;
  readonly eventId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly occurredAt: Date;
  readonly payload: JsonObject;
  readonly sequence: bigint | number | string;
}

const DEFAULT_BATCH_SIZE = 50;

function positiveInteger(name: string, value: number, maximum: number): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} deve ser um inteiro entre 1 e ${maximum}.`);
  }
  return value;
}

export async function recordOutboxMessage(
  transaction: DatabaseTransaction,
  input: OutboxMessageInput,
): Promise<void> {
  await transaction.insert(outboxMessages).values({
    ...input,
    createdAt: input.occurredAt,
    nextAttemptAt: input.occurredAt,
  });
}

async function claimOutboxMessages(
  database: Database,
  options: {
    readonly eventId?: string;
    readonly leaseMs: number;
    readonly limit: number;
    readonly maximumAttempts: number;
    readonly now: Date;
  },
): Promise<OutboxMessage[]> {
  const leaseUntil = new Date(options.now.getTime() + options.leaseMs);
  const eventFilter = options.eventId
    ? sql`and message.event_id = ${options.eventId}::uuid`
    : sql``;

  return withTransaction(database, async (transaction) => {
    const result = await transaction.execute<ClaimedOutboxRow>(sql`
      with candidates as (
        select message.event_id
        from app.outbox_messages as message
        where message.attempts < ${options.maximumAttempts}
          and message.next_attempt_at <= ${options.now}
          and message.status in ('pending', 'failed', 'publishing')
          ${eventFilter}
        order by message.next_attempt_at, message.created_at, message.event_id
        for update skip locked
        limit ${options.limit}
      )
      update app.outbox_messages as message
      set
        status = 'publishing',
        attempts = message.attempts + 1,
        next_attempt_at = ${leaseUntil}
      from candidates
      where message.event_id = candidates.event_id
      returning
        message.event_id as "eventId",
        message.correlation_id as "correlationId",
        message.aggregate_type as "aggregateType",
        message.aggregate_id as "aggregateId",
        message.sequence,
        message.event_type as "eventType",
        message.event_version as "eventVersion",
        message.payload,
        message.occurred_at as "occurredAt",
        message.attempts
    `);

    return result.rows.map(({ correlationId, ...row }) => ({
      ...row,
      ...(correlationId ? { correlationId } : {}),
      sequence: BigInt(row.sequence),
    }));
  });
}

async function markPublished(
  database: Database,
  eventId: string,
  publishedAt: Date,
): Promise<void> {
  const rows = await database
    .update(outboxMessages)
    .set({ publishedAt, status: "published" })
    .where(and(eq(outboxMessages.eventId, eventId), eq(outboxMessages.status, "publishing")))
    .returning({ eventId: outboxMessages.eventId });
  if (rows.length !== 1) {
    throw new Error("OUTBOX_PUBLISH_STATE_LOST");
  }
}

async function markFailed(database: Database, eventId: string, nextAttemptAt: Date): Promise<void> {
  const rows = await database
    .update(outboxMessages)
    .set({ nextAttemptAt, status: "failed" })
    .where(and(eq(outboxMessages.eventId, eventId), eq(outboxMessages.status, "publishing")))
    .returning({ eventId: outboxMessages.eventId });
  if (rows.length !== 1) {
    throw new Error("OUTBOX_RETRY_STATE_LOST");
  }
}

export function createOutboxDispatcher(
  database: Database,
  options: OutboxDispatcherOptions,
): OutboxDispatcher {
  const leaseMs = positiveInteger("leaseMs", options.leaseMs ?? 30_000, 10 * 60_000);
  const maximumAttempts = positiveInteger("maximumAttempts", options.maximumAttempts ?? 10, 100);
  const retryBaseMs = positiveInteger("retryBaseMs", options.retryBaseMs ?? 1_000, 60_000);
  const retryMaximumMs = positiveInteger(
    "retryMaximumMs",
    options.retryMaximumMs ?? 5 * 60_000,
    24 * 60 * 60_000,
  );
  const clock = options.clock ?? (() => new Date());

  async function publish(message: OutboxMessage): Promise<boolean> {
    try {
      await options.publisher.publish(message);
    } catch {
      const retryDelay = Math.min(
        retryBaseMs * 2 ** Math.max(0, message.attempts - 1),
        retryMaximumMs,
      );
      await markFailed(database, message.eventId, new Date(clock().getTime() + retryDelay));
      return false;
    }
    await markPublished(database, message.eventId, clock());
    return true;
  }

  return {
    async dispatchBatch(limit = DEFAULT_BATCH_SIZE) {
      const validLimit = positiveInteger("limit", limit, 500);
      const messages = await claimOutboxMessages(database, {
        leaseMs,
        limit: validLimit,
        maximumAttempts,
        now: clock(),
      });
      let published = 0;
      for (const message of messages) {
        if (await publish(message)) {
          published += 1;
        }
      }
      return {
        claimed: messages.length,
        deferred: messages.length - published,
        published,
      };
    },
    async dispatchNow(eventId) {
      const [message] = await claimOutboxMessages(database, {
        eventId,
        leaseMs,
        limit: 1,
        maximumAttempts,
        now: clock(),
      });
      if (!message) {
        return "unavailable";
      }
      return (await publish(message)) ? "published" : "deferred";
    },
  };
}

export async function getOutboxMessage(
  database: Database,
  eventId: string,
): Promise<typeof outboxMessages.$inferSelect | undefined> {
  const [message] = await database
    .select()
    .from(outboxMessages)
    .where(eq(outboxMessages.eventId, eventId))
    .limit(1);
  return message;
}
