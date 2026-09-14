import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { appSchema } from "../namespaces.js";

export const outboxStatus = appSchema.enum("outbox_status", [
  "pending",
  "publishing",
  "published",
  "failed",
]);

export const outboxMessages = appSchema.table(
  "outbox_messages",
  {
    eventId: uuid("event_id").primaryKey(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    sequence: bigint("sequence", { mode: "bigint" }).notNull(),
    eventType: text("event_type").notNull(),
    eventVersion: integer("event_version").default(1).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: outboxStatus("status").default("pending").notNull(),
    attempts: smallint("attempts").default(0).notNull(),
    occurredAt: timestamp("occurred_at", { mode: "date", withTimezone: true }).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    publishedAt: timestamp("published_at", { mode: "date", withTimezone: true }),
  },
  (table) => [
    uniqueIndex("outbox_messages_aggregate_sequence_unique").on(
      table.aggregateType,
      table.aggregateId,
      table.sequence,
    ),
    index("outbox_messages_dispatch_idx").on(table.status, table.nextAttemptAt),
    check("outbox_messages_sequence_positive", sql`${table.sequence} > 0`),
    check("outbox_messages_event_version_positive", sql`${table.eventVersion} > 0`),
    check("outbox_messages_attempts_nonnegative", sql`${table.attempts} >= 0`),
  ],
);
