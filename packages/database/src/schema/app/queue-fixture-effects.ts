import { sql } from "drizzle-orm";
import { check, index, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { appSchema } from "../namespaces.js";

export const queueFixtureEffects = appSchema.table(
  "queue_fixture_effects",
  {
    effectId: uuid("effect_id").primaryKey(),
    jobId: text("job_id").notNull(),
    jobName: text("job_name").notNull(),
    jobVersion: smallint("job_version").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    appliedAt: timestamp("applied_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("queue_fixture_effects_job_id_unique").on(table.jobId),
    index("queue_fixture_effects_correlation_idx").on(table.correlationId),
    check("queue_fixture_effects_job_version_positive", sql`${table.jobVersion} > 0`),
  ],
);
