import { sql } from "drizzle-orm";
import { bigint, check, timestamp, uuid } from "drizzle-orm/pg-core";
import { appSchema } from "../namespaces.js";

export const matchSequences = appSchema.table(
  "match_sequences",
  {
    matchId: uuid("match_id").primaryKey(),
    lastSequence: bigint("last_sequence", { mode: "bigint" }).default(sql`0`).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [check("match_sequences_last_sequence_nonnegative", sql`${table.lastSequence} >= 0`)],
);
