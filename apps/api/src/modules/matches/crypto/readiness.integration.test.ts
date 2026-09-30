import {
  applyMigrations,
  createMigrationDatabase,
  type DatabaseRuntime,
} from "@arquibancada-viva/database";
import {
  assertLocalTestUrl,
  createTestPublicId,
  createTestRunId,
  databaseUrlForName,
} from "@arquibancada-viva/testing";
import { setTimeout } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freezeRulesSnapshot } from "./rules.js";
import { checkDatabaseCompetitiveReadiness } from "./readiness.js";

describe("database-backed competitive RNG availability", () => {
  const adminUrl =
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgresql://app:app@127.0.0.1:5432/arquibancada_viva";
  assertLocalTestUrl(adminUrl, ["postgres:", "postgresql:"]);
  const name = createTestRunId("av_met005");
  const admin = createMigrationDatabase(adminUrl);
  let runtime: DatabaseRuntime | undefined;
  let created = false;
  const config = {
    MATCH_ENGINE_ENABLED: true,
    MATCH_RNG_ACTIVE_KEY_VERSION: "synthetic-current",
    MATCH_RNG_KEYRING_JSON: { "synthetic-current": "ab".repeat(32) },
  };

  beforeAll(async () => {
    await admin.pool.query(`CREATE DATABASE "${name}"`);
    created = true;
    runtime = createMigrationDatabase(databaseUrlForName(adminUrl, name));
    await applyMigrations(runtime.database);
    const clubId = createTestPublicId();
    const homeId = createTestPublicId();
    const awayId = createTestPublicId();
    await runtime.pool.query(
      "INSERT INTO app.competitive_clubs(club_id,name) VALUES($1,'Synthetic readiness')",
      [clubId],
    );
    for (const groupId of [homeId, awayId]) {
      await runtime.pool.query(
        "INSERT INTO app.competitive_groups(group_id,club_id,approved) VALUES($1,$2,true)",
        [groupId, clubId],
      );
    }
    const snapshot = freezeRulesSnapshot();
    for (const [state, version] of [
      ["scheduled", "synthetic-old"],
      ["active", "synthetic-current"],
      ["cancelled", "synthetic-removed"],
    ] as const) {
      await runtime.pool.query(
        "INSERT INTO app.matches(match_id,home_group_id,away_group_id,starts_at,ends_at,rules_snapshot,rules_hash,rng_key_version,state) VALUES($1,$2,$3,'2026-09-30T00:00:00Z','2026-09-30T02:00:00Z',$4,$5,$6,$7)",
        [createTestPublicId(), homeId, awayId, snapshot.rules, snapshot.hash, version, state],
      );
    }
  });

  afterAll(async () => {
    try {
      await runtime?.close();
      if (created) {
        if (!/^av_met005_[a-z0-9_]+$/u.test(name)) throw new Error("Unsafe isolated database name");
        for (let attempt = 0; attempt < 8; attempt += 1) {
          try {
            await admin.pool.query(`DROP DATABASE IF EXISTS "${name}"`);
            break;
          } catch (error) {
            if (
              attempt === 7 ||
              !(error instanceof Error) ||
              !("code" in error) ||
              error.code !== "55006"
            )
              throw error;
            await setTimeout(25 * (attempt + 1));
          }
        }
      }
    } finally {
      await admin.close();
    }
  });

  it("requires frozen keys for scheduled and active matches without fallback", async () => {
    if (!runtime) throw new Error("Fixture unavailable");
    expect(await checkDatabaseCompetitiveReadiness(runtime.database, config)).toEqual({
      status: "unavailable",
    });
    expect(
      await checkDatabaseCompetitiveReadiness(runtime.database, {
        ...config,
        MATCH_RNG_KEYRING_JSON: {
          ...config.MATCH_RNG_KEYRING_JSON,
          "synthetic-old": "cd".repeat(32),
        },
      }),
    ).toEqual({ status: "ready" });
  });

  it("disabled engine does not require any key even with live nonterminal matches", async () => {
    if (!runtime) throw new Error("Fixture unavailable");
    expect(
      await checkDatabaseCompetitiveReadiness(runtime.database, {
        MATCH_ENGINE_ENABLED: false,
        MATCH_RNG_KEYRING_JSON: {},
      }),
    ).toEqual({ status: "disabled" });
  });
});
