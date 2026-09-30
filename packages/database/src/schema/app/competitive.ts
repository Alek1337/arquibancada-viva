import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  CompetitiveBuildState,
  CompetitiveReceiptRecord,
  CompetitiveResultRecord,
  CompetitiveRulesRecord,
} from "../../competitive-model.js";
import { appSchema } from "../namespaces.js";

const safe = sql.raw("9007199254740991");
const utc = (name: string) => timestamp(name, { mode: "date", withTimezone: true });
const count = (name: string) => bigint(name, { mode: "bigint" });
export const competitiveMatchState = appSchema.enum("competitive_match_state", [
  "scheduled",
  "active",
  "finished",
  "cancelled",
]);
export const competitiveModality = appSchema.enum("competitive_modality", [
  "battery",
  "mosaic",
  "fireworks",
  "flag",
]);
export const competitiveMembershipState = appSchema.enum("competitive_membership_state", [
  "approved",
  "blocked",
  "revoked",
]);
export const competitiveClubs = appSchema.table("competitive_clubs", {
  clubId: uuid("club_id").primaryKey(),
  name: text("name").notNull(),
});
export const competitiveGroups = appSchema.table(
  "competitive_groups",
  {
    groupId: uuid("group_id").primaryKey(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => competitiveClubs.clubId),
    approved: boolean("approved").default(false).notNull(),
    integrationVersion: count("integration_version").default(sql`0`).notNull(),
  },
  (t) => [
    unique("competitive_groups_group_club_unique").on(t.groupId, t.clubId),
    check("competitive_groups_version_safe", sql`${t.integrationVersion} BETWEEN 0 AND ${safe}`),
  ],
);
// Intentionally independent of auth.user: deleting authentication must not cascade
// into the competitive audit trail. A missing auth identity never authorizes this projection.
export const competitiveAccounts = appSchema.table(
  "competitive_accounts",
  {
    userId: text("user_id").primaryKey(),
    clubId: uuid("club_id").references(() => competitiveClubs.clubId),
    principalGroupId: uuid("principal_group_id"),
    betaAccessApproved: boolean("beta_access_approved").default(false).notNull(),
    age18Approved: boolean("age_18_approved").default(false).notNull(),
    blocked: boolean("blocked").default(false).notNull(),
    integrationVersion: count("integration_version").default(sql`0`).notNull(),
    buildVersion: count("build_version").default(sql`0`).notNull(),
    batteryLevel: integer("battery_level").default(0).notNull(),
    batteryXp: count("battery_xp").default(sql`0`).notNull(),
    mosaicLevel: integer("mosaic_level").default(0).notNull(),
    mosaicXp: count("mosaic_xp").default(sql`0`).notNull(),
    fireworksLevel: integer("fireworks_level").default(0).notNull(),
    fireworksXp: count("fireworks_xp").default(sql`0`).notNull(),
    flagLevel: integer("flag_level").default(0).notNull(),
    flagXp: count("flag_xp").default(sql`0`).notNull(),
    nextAllowedAt: utc("next_allowed_at"),
  },
  (t) => [
    unique("competitive_accounts_user_club_unique").on(t.userId, t.clubId),
    foreignKey({
      columns: [t.principalGroupId, t.clubId],
      foreignColumns: [competitiveGroups.groupId, competitiveGroups.clubId],
      name: "competitive_accounts_principal_club_fk",
    }),
    check(
      "competitive_accounts_principal_requires_club",
      sql`${t.principalGroupId} IS NULL OR ${t.clubId} IS NOT NULL`,
    ),
    check(
      "competitive_accounts_levels",
      sql`${t.batteryLevel} BETWEEN 0 AND 50 AND ${t.mosaicLevel} BETWEEN 0 AND 50 AND ${t.fireworksLevel} BETWEEN 0 AND 50 AND ${t.flagLevel} BETWEEN 0 AND 50 AND ${t.batteryLevel}+${t.mosaicLevel}+${t.fireworksLevel}+${t.flagLevel} <= 100`,
    ),
    check(
      "competitive_accounts_safe_counters",
      sql`${t.batteryXp} BETWEEN 0 AND ${safe} AND ${t.mosaicXp} BETWEEN 0 AND ${safe} AND ${t.fireworksXp} BETWEEN 0 AND ${safe} AND ${t.flagXp} BETWEEN 0 AND ${safe} AND ${t.buildVersion} BETWEEN 0 AND ${safe} AND ${t.integrationVersion} BETWEEN 0 AND ${safe}`,
    ),
  ],
);
export const competitiveMemberships = appSchema.table(
  "competitive_memberships",
  {
    userId: text("user_id").notNull(),
    groupId: uuid("group_id").notNull(),
    clubId: uuid("club_id").notNull(),
    state: competitiveMembershipState("state").default("revoked").notNull(),
    integrationVersion: count("integration_version").default(sql`0`).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.groupId] }),
    foreignKey({
      columns: [t.userId, t.clubId],
      foreignColumns: [competitiveAccounts.userId, competitiveAccounts.clubId],
      name: "competitive_memberships_account_club_fk",
    }),
    foreignKey({
      columns: [t.groupId, t.clubId],
      foreignColumns: [competitiveGroups.groupId, competitiveGroups.clubId],
      name: "competitive_memberships_group_club_fk",
    }),
    check(
      "competitive_memberships_version_safe",
      sql`${t.integrationVersion} BETWEEN 0 AND ${safe}`,
    ),
  ],
);
export const competitiveBuildCheckpoints = appSchema.table(
  "competitive_build_checkpoints",
  {
    userId: text("user_id")
      .notNull()
      .references(() => competitiveAccounts.userId),
    buildVersion: count("build_version").notNull(),
    build: jsonb("build").$type<CompetitiveBuildState>().notNull(),
    createdAt: utc("created_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.buildVersion] }),
    check("competitive_checkpoints_version_safe", sql`${t.buildVersion} BETWEEN 0 AND ${safe}`),
    check("competitive_checkpoints_build", sql`app.competitive_build_is_valid(${t.build})`),
  ],
);
export const competitiveMatches = appSchema.table(
  "matches",
  {
    matchId: uuid("match_id").primaryKey(),
    homeGroupId: uuid("home_group_id")
      .notNull()
      .references(() => competitiveGroups.groupId),
    awayGroupId: uuid("away_group_id")
      .notNull()
      .references(() => competitiveGroups.groupId),
    startsAt: utc("starts_at").notNull(),
    endsAt: utc("ends_at").notNull(),
    state: competitiveMatchState("state").default("scheduled").notNull(),
    rulesSnapshot: jsonb("rules_snapshot").$type<CompetitiveRulesRecord>().notNull(),
    rulesHash: text("rules_hash").notNull(),
    rngKeyVersion: text("rng_key_version").notNull(),
    homeBatteryTenths: count("home_battery_tenths").default(sql`0`).notNull(),
    homeMosaicTenths: count("home_mosaic_tenths").default(sql`0`).notNull(),
    homeFireworksTenths: count("home_fireworks_tenths").default(sql`0`).notNull(),
    homeFlagTenths: count("home_flag_tenths").default(sql`0`).notNull(),
    awayBatteryTenths: count("away_battery_tenths").default(sql`0`).notNull(),
    awayMosaicTenths: count("away_mosaic_tenths").default(sql`0`).notNull(),
    awayFireworksTenths: count("away_fireworks_tenths").default(sql`0`).notNull(),
    awayFlagTenths: count("away_flag_tenths").default(sql`0`).notNull(),
    lastSequence: count("last_sequence").default(sql`0`).notNull(),
    result: jsonb("result").$type<CompetitiveResultRecord>(),
    finishedAt: utc("finished_at"),
  },
  (t) => [
    index("competitive_matches_due_idx").on(t.state, t.endsAt),
    check("competitive_matches_distinct_groups", sql`${t.homeGroupId} <> ${t.awayGroupId}`),
    check("competitive_matches_interval", sql`${t.endsAt} > ${t.startsAt}`),
    check(
      "competitive_matches_rules",
      sql`coalesce(jsonb_typeof(${t.rulesSnapshot})='object' AND ${t.rulesSnapshot}->>'schemaVersion'='1' AND length(${t.rulesSnapshot}->>'ruleVersion')>0 AND ${t.rulesHash} ~ '^[0-9a-f]{64}$' AND length(${t.rngKeyVersion})>0, false)`,
    ),
    check(
      "competitive_matches_scores_safe",
      sql`${t.homeBatteryTenths} >=0 AND ${t.homeMosaicTenths} >=0 AND ${t.homeFireworksTenths} >=0 AND ${t.homeFlagTenths} >=0 AND ${t.awayBatteryTenths} >=0 AND ${t.awayMosaicTenths} >=0 AND ${t.awayFireworksTenths} >=0 AND ${t.awayFlagTenths} >=0 AND ${t.homeBatteryTenths}+${t.homeMosaicTenths}+${t.homeFireworksTenths}+${t.homeFlagTenths} <= ${safe} AND ${t.awayBatteryTenths}+${t.awayMosaicTenths}+${t.awayFireworksTenths}+${t.awayFlagTenths} <= ${safe} AND ${t.lastSequence} BETWEEN 0 AND ${safe}`,
    ),
    check(
      "competitive_matches_result_lifecycle",
      sql`(${t.state}='finished' AND ${t.result} IS NOT NULL AND jsonb_typeof(${t.result})='object' AND ${t.finishedAt} IS NOT NULL) OR (${t.state}<>'finished' AND ${t.result} IS NULL AND ${t.finishedAt} IS NULL)`,
    ),
  ],
);
export const competitiveParticipants = appSchema.table(
  "match_participants",
  {
    matchId: uuid("match_id")
      .notNull()
      .references(() => competitiveMatches.matchId),
    userId: text("user_id")
      .notNull()
      .references(() => competitiveAccounts.userId),
    selectedGroupId: uuid("selected_group_id").references(() => competitiveGroups.groupId),
    lockedGroupId: uuid("locked_group_id").references(() => competitiveGroups.groupId),
    firstAcceptedActionId: uuid("first_accepted_action_id"),
    firstBuildCheckpoint: jsonb("first_build_checkpoint").$type<CompetitiveBuildState>(),
    firstBuildVersion: count("first_build_version"),
  },
  (t) => [
    primaryKey({ columns: [t.matchId, t.userId] }),
    index("competitive_participants_user_idx").on(t.userId),
    check(
      "competitive_participants_lock_complete",
      sql`(${t.lockedGroupId} IS NULL AND ${t.firstAcceptedActionId} IS NULL AND ${t.firstBuildCheckpoint} IS NULL AND ${t.firstBuildVersion} IS NULL) OR (${t.lockedGroupId} IS NOT NULL AND ${t.firstAcceptedActionId} IS NOT NULL AND ${t.firstBuildCheckpoint} IS NOT NULL AND app.competitive_build_is_valid(${t.firstBuildCheckpoint}) AND ${t.firstBuildVersion} IS NOT NULL AND ${t.firstBuildVersion} BETWEEN 0 AND ${safe})`,
    ),
  ],
);
export const competitiveActionReceipts = appSchema.table(
  "competitive_action_receipts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => competitiveAccounts.userId),
    actionId: uuid("action_id").notNull(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => competitiveMatches.matchId),
    keyHash: text("key_hash").notNull(),
    requestHash: text("request_hash").notNull(),
    result: jsonb("result").$type<CompetitiveReceiptRecord>().notNull(),
    acceptedAt: utc("accepted_at").notNull(),
    eventId: uuid("event_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.actionId] }),
    unique("competitive_receipts_key_unique").on(t.userId, t.matchId, t.keyHash),
    unique("competitive_receipts_identity_unique").on(
      t.userId,
      t.actionId,
      t.matchId,
      t.eventId,
      t.acceptedAt,
    ),
    unique("competitive_receipts_event_unique").on(t.eventId),
    check(
      "competitive_receipts_hashes",
      sql`${t.keyHash} ~ '^[0-9a-f]{64}$' AND ${t.requestHash} ~ '^[0-9a-f]{64}$' AND jsonb_typeof(${t.result})='object'`,
    ),
  ],
);
export const competitiveActions = appSchema.table(
  "competitive_actions",
  {
    userId: text("user_id").notNull(),
    actionId: uuid("action_id").notNull(),
    matchId: uuid("match_id").notNull(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => competitiveGroups.groupId),
    modality: competitiveModality("modality").notNull(),
    matchSequence: count("match_sequence").notNull(),
    accountBuildVersion: count("account_build_version").notNull(),
    stateBefore: jsonb("state_before").$type<CompetitiveBuildState>().notNull(),
    stateAfter: jsonb("state_after").$type<CompetitiveBuildState>().notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    sample: integer("sample").notNull(),
    rngAlgorithmVersion: text("rng_algorithm_version").notNull(),
    bonus: boolean("bonus").notNull(),
    deltaTenths: count("delta_tenths").notNull(),
    acceptedAt: utc("accepted_at").notNull(),
    eventId: uuid("event_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.actionId] }),
    unique("competitive_actions_match_sequence_unique").on(t.matchId, t.matchSequence),
    unique("competitive_actions_build_version_unique").on(t.userId, t.accountBuildVersion),
    foreignKey({
      columns: [t.matchId, t.userId],
      foreignColumns: [competitiveParticipants.matchId, competitiveParticipants.userId],
      name: "competitive_actions_participant_fk",
    }),
    foreignKey({
      columns: [t.userId, t.actionId, t.matchId, t.eventId, t.acceptedAt],
      foreignColumns: [
        competitiveActionReceipts.userId,
        competitiveActionReceipts.actionId,
        competitiveActionReceipts.matchId,
        competitiveActionReceipts.eventId,
        competitiveActionReceipts.acceptedAt,
      ],
      name: "competitive_actions_receipt_fk",
    }),
    check(
      "competitive_actions_safe_counters",
      sql`${t.matchSequence} BETWEEN 1 AND ${safe} AND ${t.accountBuildVersion} BETWEEN 1 AND ${safe} AND ${t.deltaTenths} BETWEEN 0 AND ${safe}`,
    ),
    check(
      "competitive_actions_audit",
      sql`${t.sample} BETWEEN 0 AND 9999 AND length(${t.rngAlgorithmVersion})>0 AND ${t.snapshotHash} ~ '^[0-9a-f]{64}$' AND app.competitive_build_is_valid(${t.stateBefore}) AND app.competitive_build_is_valid(${t.stateAfter})`,
    ),
  ],
);
