import { eq } from "drizzle-orm";
import type { Database } from "./pool.js";
import { queueFixtureEffects } from "./schema/index.js";

export interface QueueFixtureEffectInput {
  readonly correlationId: string;
  readonly effectId: string;
  readonly jobId: string;
  readonly jobName: string;
  readonly jobVersion: number;
}

export async function applyQueueFixtureEffect(
  database: Database,
  input: QueueFixtureEffectInput,
): Promise<boolean> {
  const inserted = await database
    .insert(queueFixtureEffects)
    .values(input)
    .onConflictDoNothing({ target: queueFixtureEffects.effectId })
    .returning({ effectId: queueFixtureEffects.effectId });
  return inserted.length === 1;
}

export async function countQueueFixtureEffects(
  database: Database,
  effectId: string,
): Promise<number> {
  const rows = await database
    .select({ effectId: queueFixtureEffects.effectId })
    .from(queueFixtureEffects)
    .where(eq(queueFixtureEffects.effectId, effectId));
  return rows.length;
}
