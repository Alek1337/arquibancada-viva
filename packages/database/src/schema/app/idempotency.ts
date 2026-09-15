import { sql } from "drizzle-orm";
import { check, index, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { appSchema } from "../namespaces.js";

export const idempotencyRecords = appSchema.table(
  "idempotency_records",
  {
    recordId: uuid("record_id").primaryKey(),
    scope: text("scope").notNull(),
    keyHash: text("key_hash").notNull(),
    requestHash: text("request_hash").notNull(),
    response: jsonb("response").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { mode: "date", withTimezone: true }),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("idempotency_records_scope_key_unique").on(table.scope, table.keyHash),
    index("idempotency_records_expiry_idx").on(table.expiresAt),
    check("idempotency_records_scope_nonempty", sql`length(${table.scope}) > 0`),
    check("idempotency_records_key_hash_length", sql`length(${table.keyHash}) = 64`),
    check("idempotency_records_request_hash_length", sql`length(${table.requestHash}) = 64`),
    check(
      "idempotency_records_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "idempotency_records_completion_consistent",
      sql`(${table.completedAt} is null and ${table.response} is null) or (${table.completedAt} is not null and ${table.response} is not null)`,
    ),
  ],
);
