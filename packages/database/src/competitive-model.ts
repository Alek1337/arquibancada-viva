import { sql } from "drizzle-orm";
import type { Database } from "./pool.js";

/** Neutral persistence types. No game rules or authorization are implemented here. */
export type CompetitiveBuildState = Record<
  "battery" | "mosaic" | "fireworks" | "flag",
  { level: number; xp: number }
>;
export interface CompetitiveRulesRecord {
  schemaVersion: 1;
  ruleVersion: string;
  baseTenths: number;
  bonusPerLevelTenths: number;
  rngThreshold: number;
  rngScale: 10000;
  cooldownMs: number;
  xpPerAction: number;
  xpBase: number;
  xpSlope: number;
  maxLevel: 50;
  maxTotalLevel: 100;
  durationMs: number;
}
export type CompetitiveResultRecord = {
  winnerGroupId: string | null;
  decidedBy: "dominance" | "total" | "draw";
};
export type CompetitiveReceiptRecord = Record<string, unknown>;

export async function getRequiredCompetitiveRngKeyVersions(database: Database): Promise<string[]> {
  const result = await database.execute<{ version: string }>(sql`
    SELECT DISTINCT rng_key_version AS version FROM app.matches
    WHERE state IN ('scheduled', 'active') ORDER BY rng_key_version
  `);
  return result.rows.map((row) => row.version);
}
