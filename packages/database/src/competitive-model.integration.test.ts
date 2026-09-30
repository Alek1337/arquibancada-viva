import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRequiredCompetitiveRngKeyVersions } from "./competitive-model.js";
import { dropIsolatedTestDatabase } from "./database-test-utils.js";
import { createPublicId } from "./identifiers.js";
import { applyMigrations } from "./migrations.js";
import { createMigrationDatabase, type DatabaseRuntime } from "./pool.js";

const adminUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://app:app@127.0.0.1:5432/arquibancada_viva";
const name = `av_met004_${process.pid}_${Date.now().toString(36)}`;
const build = {
  battery: { level: 0, xp: 0 },
  mosaic: { level: 0, xp: 0 },
  fireworks: { level: 0, xp: 0 },
  flag: { level: 0, xp: 0 },
};
const rules = {
  schemaVersion: 1,
  ruleVersion: "test-v1",
  baseTenths: 100,
  bonusPerLevelTenths: 1,
  rngThreshold: 2000,
  rngScale: 10000,
  cooldownMs: 45000,
  xpPerAction: 1,
  xpBase: 10,
  xpSlope: 2,
  maxLevel: 50,
  maxTotalLevel: 100,
  durationMs: 7200000,
};
const hash = "a".repeat(64);

describe("competitive durable model", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  let runtime: DatabaseRuntime;
  let created = false;
  beforeAll(async () => {
    if (!/^[a-z0-9_]+$/u.test(name)) throw new Error("Unsafe isolated database name");
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    const url = new URL(adminUrl);
    url.pathname = `/${name}`;
    runtime = createMigrationDatabase(url.toString());
    await applyMigrations(runtime.database);
  });
  afterAll(async () => {
    await runtime?.close();
    if (created) {
      await dropIsolatedTestDatabase(admin, name);
    }
    await admin.end();
  });
  async function fixture() {
    const club = createPublicId();
    const home = createPublicId();
    const away = createPublicId();
    const third = createPublicId();
    const match = createPublicId();
    const user = `fixture-${createPublicId()}`;
    await runtime.pool.query(
      "INSERT INTO app.competitive_clubs(club_id,name) VALUES($1,'Synthetic fixture')",
      [club],
    );
    for (const group of [home, away, third])
      await runtime.pool.query(
        "INSERT INTO app.competitive_groups(group_id,club_id,approved) VALUES($1,$2,true)",
        [group, club],
      );
    await runtime.pool.query(
      "INSERT INTO app.competitive_accounts(user_id,club_id) VALUES($1,$2)",
      [user, club],
    );
    await runtime.pool.query(
      "INSERT INTO app.competitive_memberships(user_id,group_id,club_id,state) VALUES($1,$2,$3,'approved')",
      [user, home, club],
    );
    await runtime.pool.query(
      "INSERT INTO app.competitive_build_checkpoints(user_id,build_version,build) VALUES($1,0,$2)",
      [user, build],
    );
    await runtime.pool.query(
      "INSERT INTO app.matches(match_id,home_group_id,away_group_id,starts_at,ends_at,rules_snapshot,rules_hash,rng_key_version) VALUES($1,$2,$3,'2026-09-30T00:00:00Z','2026-09-30T02:00:00Z',$4,$5,'test-key-v1')",
      [match, home, away, rules, hash],
    );
    await runtime.pool.query(
      "INSERT INTO app.match_participants(match_id,user_id,selected_group_id) VALUES($1,$2,$3)",
      [match, user, home],
    );
    return { club, home, away, third, match, user };
  }
  async function accepted(
    client: PoolClient,
    f: Awaited<ReturnType<typeof fixture>>,
    sequence = 1,
    key = "b".repeat(64),
  ) {
    const action = createPublicId();
    const event = createPublicId();
    const at = "2026-09-30T00:00:01Z";
    await client.query(
      "UPDATE app.match_participants SET locked_group_id=$3,first_accepted_action_id=$4,first_build_checkpoint=$5,first_build_version=0 WHERE match_id=$1 AND user_id=$2",
      [f.match, f.user, f.home, action, build],
    );
    await client.query(
      "INSERT INTO app.competitive_action_receipts(user_id,action_id,match_id,key_hash,request_hash,result,accepted_at,event_id) VALUES($1,$2,$3,$4,$5,'{}',$6,$7)",
      [f.user, action, f.match, key, hash, at, event],
    );
    await client.query(
      "INSERT INTO app.competitive_actions(user_id,action_id,match_id,group_id,modality,match_sequence,account_build_version,state_before,state_after,snapshot_hash,sample,rng_algorithm_version,bonus,delta_tenths,accepted_at,event_id) VALUES($1,$2,$3,$4,'battery',$5,$5,$6,$6,$7,1999,'hmac-sha256-v1',true,100,$8,$9)",
      [f.user, action, f.match, f.home, sequence, build, hash, at, event],
    );
    return { action, event };
  }
  it("defaults fail closed and discovers required keys from nonterminal matches", async () => {
    const f = await fixture();
    expect(
      (
        await runtime.pool.query(
          "SELECT beta_access_approved,age_18_approved FROM app.competitive_accounts WHERE user_id=$1",
          [f.user],
        )
      ).rows[0],
    ).toEqual({ beta_access_approved: false, age_18_approved: false });
    expect(await getRequiredCompetitiveRngKeyVersions(runtime.database)).toEqual(["test-key-v1"]);
  });
  it("rejects level caps, total cap, negative XP and unsafe versions", async () => {
    const f = await fixture();
    for (const assignment of [
      "battery_level=51",
      "battery_level=50,mosaic_level=50,flag_level=1",
      "battery_xp=-1",
      "build_version=9007199254740992",
    ]) {
      await expect(
        runtime.pool.query(`UPDATE app.competitive_accounts SET ${assignment} WHERE user_id=$1`, [
          f.user,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    }
    await expect(
      runtime.pool.query(
        "INSERT INTO app.competitive_build_checkpoints(user_id,build_version,build) VALUES($1,1,$2)",
        [f.user, { ...build, battery: { level: 51, xp: 0 } }],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("requires common clubs for membership and principal group", async () => {
    const f = await fixture();
    const other = await fixture();
    await expect(
      runtime.pool.query(
        "INSERT INTO app.competitive_memberships(user_id,group_id,club_id,state) VALUES($1,$2,$3,'approved')",
        [f.user, other.home, f.club],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      runtime.pool.query(
        "UPDATE app.competitive_accounts SET principal_group_id=$2 WHERE user_id=$1",
        [f.user, other.home],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });
  it("rejects identical groups, unsafe scores, invalid snapshots and unrelated participant sides", async () => {
    const f = await fixture();
    await expect(
      runtime.pool.query(
        "INSERT INTO app.matches(match_id,home_group_id,away_group_id,starts_at,ends_at,rules_snapshot,rules_hash,rng_key_version) VALUES($1,$2,$2,'2026-09-30','2026-10-01',$3,$4,'test')",
        [createPublicId(), f.home, rules, hash],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      runtime.pool.query(
        "UPDATE app.matches SET home_battery_tenths=9007199254740991,home_flag_tenths=1 WHERE match_id=$1",
        [f.match],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      runtime.pool.query(
        "UPDATE app.match_participants SET selected_group_id=$3 WHERE match_id=$1 AND user_id=$2",
        [f.match, f.user, f.third],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      runtime.pool.query(
        "INSERT INTO app.matches(match_id,home_group_id,away_group_id,starts_at,ends_at,rules_snapshot,rules_hash,rng_key_version) VALUES($1,$2,$3,'2026-09-30','2026-10-01','{}',$4,'test')",
        [createPublicId(), f.home, f.away, hash],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("freezes creation configuration and finished scores/results", async () => {
    const f = await fixture();
    for (const assignment of [
      "rules_snapshot='{}'",
      "rules_hash='cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'",
      "rng_key_version='replacement'",
      "ends_at=ends_at+interval '1 hour'",
    ]) {
      await expect(
        runtime.pool.query(`UPDATE app.matches SET ${assignment} WHERE match_id=$1`, [f.match]),
      ).rejects.toMatchObject({ code: "23514" });
    }
    await runtime.pool.query(
      "UPDATE app.matches SET state='finished',result=$2,finished_at='2026-09-30T02:00:00Z' WHERE match_id=$1",
      [f.match, { winnerGroupId: null, decidedBy: "draw" }],
    );
    for (const assignment of ["home_battery_tenths=1", "result='{}'", "state='active'"])
      await expect(
        runtime.pool.query(`UPDATE app.matches SET ${assignment} WHERE match_id=$1`, [f.match]),
      ).rejects.toMatchObject({ code: "23514" });
  });
  it("commits receipt and ledger only together and preserves audit after auth deletion", async () => {
    const f = await fixture();
    const client = await runtime.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO app.competitive_action_receipts(user_id,action_id,match_id,key_hash,request_hash,result,accepted_at,event_id) VALUES($1,$2,$3,$4,$4,'{}','2026-09-30T00:00:01Z',$5)",
        [f.user, createPublicId(), f.match, hash, createPublicId()],
      );
      await expect(client.query("COMMIT")).rejects.toMatchObject({ code: "23503" });
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      const action = await accepted(client, f);
      await client.query("COMMIT");
      await client.query("INSERT INTO auth.\"user\"(id,name,email) VALUES($1,'Synthetic',$2)", [
        f.user,
        `${f.user}@example.invalid`,
      ]);
      await client.query('DELETE FROM auth."user" WHERE id=$1', [f.user]);
      expect(
        (
          await client.query("SELECT action_id FROM app.competitive_actions WHERE user_id=$1", [
            f.user,
          ])
        ).rows,
      ).toEqual([{ action_id: action.action }]);
      await expect(
        client.query("UPDATE app.competitive_actions SET delta_tenths=101 WHERE user_id=$1", [
          f.user,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query("DELETE FROM app.competitive_action_receipts WHERE user_id=$1", [f.user]),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query("UPDATE app.matches SET state='cancelled' WHERE match_id=$1", [f.match]),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
  it("looks up only required scheduled or active RNG versions", async () => {
    const terminal = await fixture();
    // Fixtures use unique versions at creation, because the snapshot/key is immutable.
    for (const [state, version] of [
      ["scheduled", "lookup-scheduled"],
      ["active", "lookup-active"],
      ["cancelled", "lookup-cancelled"],
      ["finished", "lookup-finished"],
    ]) {
      await runtime.pool.query(
        "INSERT INTO app.matches(match_id,home_group_id,away_group_id,starts_at,ends_at,rules_snapshot,rules_hash,rng_key_version,state,result,finished_at) VALUES($1,$2,$3,'2026-09-30','2026-10-01',$4,$5,$6,$7,$8,$9)",
        [
          createPublicId(),
          terminal.home,
          terminal.away,
          rules,
          hash,
          version,
          state,
          state === "finished" ? { winnerGroupId: null, decidedBy: "draw" } : null,
          state === "finished" ? new Date("2026-10-01") : null,
        ],
      );
    }
    const versions = await getRequiredCompetitiveRngKeyVersions(runtime.database);
    expect(versions).toContain("lookup-scheduled");
    expect(versions).toContain("lookup-active");
    expect(versions).not.toContain("lookup-finished");
    expect(versions).not.toContain("lookup-cancelled");
  });
  it("rejects duplicate match sequences and contradictory receipt identity", async () => {
    const f = await fixture();
    const client = await runtime.pool.connect();
    try {
      await client.query("BEGIN");
      const first = await accepted(client, f);
      await client.query("COMMIT");
      await client.query("BEGIN");
      const action = createPublicId();
      const event = createPublicId();
      await client.query(
        "INSERT INTO app.competitive_action_receipts(user_id,action_id,match_id,key_hash,request_hash,result,accepted_at,event_id) VALUES($1,$2,$3,$4,$5,'{}','2026-09-30T00:00:01Z',$6)",
        [f.user, action, f.match, "c".repeat(64), hash, event],
      );
      const insert =
        "INSERT INTO app.competitive_actions(user_id,action_id,match_id,group_id,modality,match_sequence,account_build_version,state_before,state_after,snapshot_hash,sample,rng_algorithm_version,bonus,delta_tenths,accepted_at,event_id) VALUES($1,$2,$3,$4,'battery',$5,2,$6,$6,$7,0,'test-v1',false,100,'2026-09-30T00:00:01Z',$8)";
      await expect(
        client.query(insert, [f.user, action, f.match, f.home, 1, build, hash, event]),
      ).rejects.toMatchObject({ code: "23505" });
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      await expect(
        client.query(insert, [
          f.user,
          first.action,
          f.match,
          f.home,
          2,
          build,
          hash,
          createPublicId(),
        ]),
      ).rejects.toMatchObject({ code: "23505" });
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO app.competitive_action_receipts(user_id,action_id,match_id,key_hash,request_hash,result,accepted_at,event_id) VALUES($1,$2,$3,$4,$5,'{}','2026-09-30T00:00:01Z',$6)",
        [f.user, action, f.match, "c".repeat(64), hash, event],
      );
      await expect(
        client.query(insert, [f.user, action, f.match, f.home, 2, build, hash, createPublicId()]),
      ).rejects.toMatchObject({ code: "23503" });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
