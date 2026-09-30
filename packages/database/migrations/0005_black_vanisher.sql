-- Structural audit validation only; mathematical rules remain in game-core.
CREATE FUNCTION app.competitive_build_is_valid(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE modality text; progress jsonb; total numeric := 0; level_value numeric; xp_value numeric;
BEGIN
  IF jsonb_typeof(value) <> 'object' THEN RETURN false; END IF;
  FOREACH modality IN ARRAY ARRAY['battery','mosaic','fireworks','flag'] LOOP
    progress := value->modality;
    IF progress IS NULL OR jsonb_typeof(progress) <> 'object'
      OR jsonb_typeof(progress->'level') IS DISTINCT FROM 'number'
      OR jsonb_typeof(progress->'xp') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    level_value := (progress->>'level')::numeric;
    xp_value := (progress->>'xp')::numeric;
    IF level_value <> trunc(level_value) OR level_value NOT BETWEEN 0 AND 50
      OR xp_value <> trunc(xp_value) OR xp_value NOT BETWEEN 0 AND 9007199254740991
      THEN RETURN false; END IF;
    total := total + level_value;
  END LOOP;
  RETURN total <= 100;
END $$;--> statement-breakpoint
CREATE TYPE "app"."competitive_match_state" AS ENUM('scheduled', 'active', 'finished', 'cancelled');--> statement-breakpoint
CREATE TYPE "app"."competitive_membership_state" AS ENUM('approved', 'blocked', 'revoked');--> statement-breakpoint
CREATE TYPE "app"."competitive_modality" AS ENUM('battery', 'mosaic', 'fireworks', 'flag');--> statement-breakpoint
CREATE TABLE "app"."competitive_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"club_id" uuid,
	"principal_group_id" uuid,
	"beta_access_approved" boolean DEFAULT false NOT NULL,
	"age_18_approved" boolean DEFAULT false NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"integration_version" bigint DEFAULT 0 NOT NULL,
	"build_version" bigint DEFAULT 0 NOT NULL,
	"battery_level" integer DEFAULT 0 NOT NULL,
	"battery_xp" bigint DEFAULT 0 NOT NULL,
	"mosaic_level" integer DEFAULT 0 NOT NULL,
	"mosaic_xp" bigint DEFAULT 0 NOT NULL,
	"fireworks_level" integer DEFAULT 0 NOT NULL,
	"fireworks_xp" bigint DEFAULT 0 NOT NULL,
	"flag_level" integer DEFAULT 0 NOT NULL,
	"flag_xp" bigint DEFAULT 0 NOT NULL,
	"next_allowed_at" timestamp with time zone,
	CONSTRAINT "competitive_accounts_user_club_unique" UNIQUE("user_id","club_id"),
	CONSTRAINT "competitive_accounts_principal_requires_club" CHECK ("app"."competitive_accounts"."principal_group_id" IS NULL OR "app"."competitive_accounts"."club_id" IS NOT NULL),
	CONSTRAINT "competitive_accounts_levels" CHECK ("app"."competitive_accounts"."battery_level" BETWEEN 0 AND 50 AND "app"."competitive_accounts"."mosaic_level" BETWEEN 0 AND 50 AND "app"."competitive_accounts"."fireworks_level" BETWEEN 0 AND 50 AND "app"."competitive_accounts"."flag_level" BETWEEN 0 AND 50 AND "app"."competitive_accounts"."battery_level"+"app"."competitive_accounts"."mosaic_level"+"app"."competitive_accounts"."fireworks_level"+"app"."competitive_accounts"."flag_level" <= 100),
	CONSTRAINT "competitive_accounts_safe_counters" CHECK ("app"."competitive_accounts"."battery_xp" BETWEEN 0 AND 9007199254740991 AND "app"."competitive_accounts"."mosaic_xp" BETWEEN 0 AND 9007199254740991 AND "app"."competitive_accounts"."fireworks_xp" BETWEEN 0 AND 9007199254740991 AND "app"."competitive_accounts"."flag_xp" BETWEEN 0 AND 9007199254740991 AND "app"."competitive_accounts"."build_version" BETWEEN 0 AND 9007199254740991 AND "app"."competitive_accounts"."integration_version" BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "app"."competitive_action_receipts" (
	"user_id" text NOT NULL,
	"action_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"key_hash" text NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"event_id" uuid NOT NULL,
	CONSTRAINT "competitive_action_receipts_user_id_action_id_pk" PRIMARY KEY("user_id","action_id"),
	CONSTRAINT "competitive_receipts_key_unique" UNIQUE("user_id","match_id","key_hash"),
	CONSTRAINT "competitive_receipts_identity_unique" UNIQUE("user_id","action_id","match_id","event_id","accepted_at"),
	CONSTRAINT "competitive_receipts_event_unique" UNIQUE("event_id"),
	CONSTRAINT "competitive_receipts_hashes" CHECK ("app"."competitive_action_receipts"."key_hash" ~ '^[0-9a-f]{64}$' AND "app"."competitive_action_receipts"."request_hash" ~ '^[0-9a-f]{64}$' AND jsonb_typeof("app"."competitive_action_receipts"."result")='object')
);
--> statement-breakpoint
CREATE TABLE "app"."competitive_actions" (
	"user_id" text NOT NULL,
	"action_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"modality" "app"."competitive_modality" NOT NULL,
	"match_sequence" bigint NOT NULL,
	"account_build_version" bigint NOT NULL,
	"state_before" jsonb NOT NULL,
	"state_after" jsonb NOT NULL,
	"snapshot_hash" text NOT NULL,
	"sample" integer NOT NULL,
	"rng_algorithm_version" text NOT NULL,
	"bonus" boolean NOT NULL,
	"delta_tenths" bigint NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"event_id" uuid NOT NULL,
	CONSTRAINT "competitive_actions_user_id_action_id_pk" PRIMARY KEY("user_id","action_id"),
	CONSTRAINT "competitive_actions_match_sequence_unique" UNIQUE("match_id","match_sequence"),
	CONSTRAINT "competitive_actions_build_version_unique" UNIQUE("user_id","account_build_version"),
	CONSTRAINT "competitive_actions_safe_counters" CHECK ("app"."competitive_actions"."match_sequence" BETWEEN 1 AND 9007199254740991 AND "app"."competitive_actions"."account_build_version" BETWEEN 1 AND 9007199254740991 AND "app"."competitive_actions"."delta_tenths" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "competitive_actions_audit" CHECK ("app"."competitive_actions"."sample" BETWEEN 0 AND 9999 AND length("app"."competitive_actions"."rng_algorithm_version")>0 AND "app"."competitive_actions"."snapshot_hash" ~ '^[0-9a-f]{64}$' AND app.competitive_build_is_valid("app"."competitive_actions"."state_before") AND app.competitive_build_is_valid("app"."competitive_actions"."state_after"))
);
--> statement-breakpoint
CREATE TABLE "app"."competitive_build_checkpoints" (
	"user_id" text NOT NULL,
	"build_version" bigint NOT NULL,
	"build" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitive_build_checkpoints_user_id_build_version_pk" PRIMARY KEY("user_id","build_version"),
	CONSTRAINT "competitive_checkpoints_version_safe" CHECK ("app"."competitive_build_checkpoints"."build_version" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "competitive_checkpoints_build" CHECK (app.competitive_build_is_valid("app"."competitive_build_checkpoints"."build"))
);
--> statement-breakpoint
CREATE TABLE "app"."competitive_clubs" (
	"club_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."competitive_groups" (
	"group_id" uuid PRIMARY KEY NOT NULL,
	"club_id" uuid NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"integration_version" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "competitive_groups_group_club_unique" UNIQUE("group_id","club_id"),
	CONSTRAINT "competitive_groups_version_safe" CHECK ("app"."competitive_groups"."integration_version" BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "app"."matches" (
	"match_id" uuid PRIMARY KEY NOT NULL,
	"home_group_id" uuid NOT NULL,
	"away_group_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"state" "app"."competitive_match_state" DEFAULT 'scheduled' NOT NULL,
	"rules_snapshot" jsonb NOT NULL,
	"rules_hash" text NOT NULL,
	"rng_key_version" text NOT NULL,
	"home_battery_tenths" bigint DEFAULT 0 NOT NULL,
	"home_mosaic_tenths" bigint DEFAULT 0 NOT NULL,
	"home_fireworks_tenths" bigint DEFAULT 0 NOT NULL,
	"home_flag_tenths" bigint DEFAULT 0 NOT NULL,
	"away_battery_tenths" bigint DEFAULT 0 NOT NULL,
	"away_mosaic_tenths" bigint DEFAULT 0 NOT NULL,
	"away_fireworks_tenths" bigint DEFAULT 0 NOT NULL,
	"away_flag_tenths" bigint DEFAULT 0 NOT NULL,
	"last_sequence" bigint DEFAULT 0 NOT NULL,
	"result" jsonb,
	"finished_at" timestamp with time zone,
	CONSTRAINT "competitive_matches_distinct_groups" CHECK ("app"."matches"."home_group_id" <> "app"."matches"."away_group_id"),
	CONSTRAINT "competitive_matches_interval" CHECK ("app"."matches"."ends_at" > "app"."matches"."starts_at"),
	CONSTRAINT "competitive_matches_rules" CHECK (coalesce(jsonb_typeof("app"."matches"."rules_snapshot")='object' AND "app"."matches"."rules_snapshot"->>'schemaVersion'='1' AND length("app"."matches"."rules_snapshot"->>'ruleVersion')>0 AND "app"."matches"."rules_hash" ~ '^[0-9a-f]{64}$' AND length("app"."matches"."rng_key_version")>0, false)),
	CONSTRAINT "competitive_matches_scores_safe" CHECK ("app"."matches"."home_battery_tenths" >=0 AND "app"."matches"."home_mosaic_tenths" >=0 AND "app"."matches"."home_fireworks_tenths" >=0 AND "app"."matches"."home_flag_tenths" >=0 AND "app"."matches"."away_battery_tenths" >=0 AND "app"."matches"."away_mosaic_tenths" >=0 AND "app"."matches"."away_fireworks_tenths" >=0 AND "app"."matches"."away_flag_tenths" >=0 AND "app"."matches"."home_battery_tenths"+"app"."matches"."home_mosaic_tenths"+"app"."matches"."home_fireworks_tenths"+"app"."matches"."home_flag_tenths" <= 9007199254740991 AND "app"."matches"."away_battery_tenths"+"app"."matches"."away_mosaic_tenths"+"app"."matches"."away_fireworks_tenths"+"app"."matches"."away_flag_tenths" <= 9007199254740991 AND "app"."matches"."last_sequence" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "competitive_matches_result_lifecycle" CHECK (("app"."matches"."state"='finished' AND "app"."matches"."result" IS NOT NULL AND jsonb_typeof("app"."matches"."result")='object' AND "app"."matches"."finished_at" IS NOT NULL) OR ("app"."matches"."state"<>'finished' AND "app"."matches"."result" IS NULL AND "app"."matches"."finished_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "app"."competitive_memberships" (
	"user_id" text NOT NULL,
	"group_id" uuid NOT NULL,
	"club_id" uuid NOT NULL,
	"state" "app"."competitive_membership_state" DEFAULT 'revoked' NOT NULL,
	"integration_version" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "competitive_memberships_user_id_group_id_pk" PRIMARY KEY("user_id","group_id"),
	CONSTRAINT "competitive_memberships_version_safe" CHECK ("app"."competitive_memberships"."integration_version" BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "app"."match_participants" (
	"match_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"selected_group_id" uuid,
	"locked_group_id" uuid,
	"first_accepted_action_id" uuid,
	"first_build_checkpoint" jsonb,
	"first_build_version" bigint,
	CONSTRAINT "match_participants_match_id_user_id_pk" PRIMARY KEY("match_id","user_id"),
	CONSTRAINT "competitive_participants_lock_complete" CHECK (("app"."match_participants"."locked_group_id" IS NULL AND "app"."match_participants"."first_accepted_action_id" IS NULL AND "app"."match_participants"."first_build_checkpoint" IS NULL AND "app"."match_participants"."first_build_version" IS NULL) OR ("app"."match_participants"."locked_group_id" IS NOT NULL AND "app"."match_participants"."first_accepted_action_id" IS NOT NULL AND "app"."match_participants"."first_build_checkpoint" IS NOT NULL AND app.competitive_build_is_valid("app"."match_participants"."first_build_checkpoint") AND "app"."match_participants"."first_build_version" IS NOT NULL AND "app"."match_participants"."first_build_version" BETWEEN 0 AND 9007199254740991))
);
--> statement-breakpoint
ALTER TABLE "app"."competitive_accounts" ADD CONSTRAINT "competitive_accounts_club_id_competitive_clubs_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "app"."competitive_clubs"("club_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."competitive_accounts" ADD CONSTRAINT "competitive_accounts_principal_club_fk" FOREIGN KEY ("principal_group_id","club_id") REFERENCES "app"."competitive_groups"("group_id","club_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."competitive_action_receipts" ADD CONSTRAINT "competitive_action_receipts_user_id_competitive_accounts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."competitive_accounts"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."competitive_action_receipts" ADD CONSTRAINT "competitive_action_receipts_match_id_matches_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "app"."matches"("match_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."competitive_actions" ADD CONSTRAINT "competitive_actions_group_id_competitive_groups_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "app"."competitive_groups"("group_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."competitive_actions" ADD CONSTRAINT "competitive_actions_participant_fk" FOREIGN KEY ("match_id","user_id") REFERENCES "app"."match_participants"("match_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."competitive_actions" ADD CONSTRAINT "competitive_actions_receipt_fk" FOREIGN KEY ("user_id","action_id","match_id","event_id","accepted_at") REFERENCES "app"."competitive_action_receipts"("user_id","action_id","match_id","event_id","accepted_at") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."competitive_build_checkpoints" ADD CONSTRAINT "competitive_build_checkpoints_user_id_competitive_accounts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."competitive_accounts"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."competitive_groups" ADD CONSTRAINT "competitive_groups_club_id_competitive_clubs_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "app"."competitive_clubs"("club_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."matches" ADD CONSTRAINT "matches_home_group_id_competitive_groups_group_id_fk" FOREIGN KEY ("home_group_id") REFERENCES "app"."competitive_groups"("group_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."matches" ADD CONSTRAINT "matches_away_group_id_competitive_groups_group_id_fk" FOREIGN KEY ("away_group_id") REFERENCES "app"."competitive_groups"("group_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."competitive_memberships" ADD CONSTRAINT "competitive_memberships_account_club_fk" FOREIGN KEY ("user_id","club_id") REFERENCES "app"."competitive_accounts"("user_id","club_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."competitive_memberships" ADD CONSTRAINT "competitive_memberships_group_club_fk" FOREIGN KEY ("group_id","club_id") REFERENCES "app"."competitive_groups"("group_id","club_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."match_participants" ADD CONSTRAINT "match_participants_match_id_matches_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "app"."matches"("match_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."match_participants" ADD CONSTRAINT "match_participants_user_id_competitive_accounts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."competitive_accounts"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."match_participants" ADD CONSTRAINT "match_participants_selected_group_id_competitive_groups_group_id_fk" FOREIGN KEY ("selected_group_id") REFERENCES "app"."competitive_groups"("group_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."match_participants" ADD CONSTRAINT "match_participants_locked_group_id_competitive_groups_group_id_fk" FOREIGN KEY ("locked_group_id") REFERENCES "app"."competitive_groups"("group_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competitive_matches_due_idx" ON "app"."matches" USING btree ("state","ends_at");--> statement-breakpoint
CREATE INDEX "competitive_participants_user_idx" ON "app"."match_participants" USING btree ("user_id");--> statement-breakpoint
-- A receipt can be inserted before its ledger row, but neither may be committed alone.
ALTER TABLE app.competitive_action_receipts ADD CONSTRAINT competitive_receipts_action_fk
  FOREIGN KEY (user_id,action_id) REFERENCES app.competitive_actions(user_id,action_id)
  DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE app.match_participants ADD CONSTRAINT competitive_participants_first_action_fk
  FOREIGN KEY (user_id,first_accepted_action_id) REFERENCES app.competitive_actions(user_id,action_id)
  DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
CREATE FUNCTION app.protect_competitive_match() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'competitive match history cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF OLD.state IN ('finished','cancelled') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'terminal match is immutable' USING ERRCODE='23514';
  END IF;
  IF ROW(NEW.match_id,NEW.home_group_id,NEW.away_group_id,NEW.starts_at,NEW.ends_at,
    NEW.rules_snapshot,NEW.rules_hash,NEW.rng_key_version) IS DISTINCT FROM
    ROW(OLD.match_id,OLD.home_group_id,OLD.away_group_id,OLD.starts_at,OLD.ends_at,
    OLD.rules_snapshot,OLD.rules_hash,OLD.rng_key_version) THEN
    RAISE EXCEPTION 'match configuration is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.state='scheduled' AND OLD.state='active' THEN
    RAISE EXCEPTION 'match lifecycle cannot regress' USING ERRCODE='23514';
  END IF;
  IF NEW.state='cancelled' AND EXISTS (SELECT 1 FROM app.competitive_actions WHERE match_id=OLD.match_id) THEN
    RAISE EXCEPTION 'accepted match cannot be cancelled' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER protect_competitive_match BEFORE UPDATE OR DELETE ON app.matches
  FOR EACH ROW EXECUTE FUNCTION app.protect_competitive_match();--> statement-breakpoint
CREATE FUNCTION app.validate_competitive_participant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE match_row app.matches;
BEGIN
  SELECT * INTO STRICT match_row FROM app.matches WHERE match_id=NEW.match_id;
  IF (NEW.selected_group_id IS NOT NULL AND NEW.selected_group_id NOT IN (match_row.home_group_id,match_row.away_group_id))
    OR (NEW.locked_group_id IS NOT NULL AND NEW.locked_group_id NOT IN (match_row.home_group_id,match_row.away_group_id)) THEN
    RAISE EXCEPTION 'participant group is not in match' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND OLD.first_accepted_action_id IS NOT NULL AND
    ROW(NEW.match_id,NEW.user_id,NEW.locked_group_id,NEW.first_accepted_action_id,NEW.first_build_checkpoint,NEW.first_build_version)
    IS DISTINCT FROM ROW(OLD.match_id,OLD.user_id,OLD.locked_group_id,OLD.first_accepted_action_id,OLD.first_build_checkpoint,OLD.first_build_version) THEN
    RAISE EXCEPTION 'accepted participant side and checkpoint are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER validate_competitive_participant BEFORE INSERT OR UPDATE ON app.match_participants
  FOR EACH ROW EXECUTE FUNCTION app.validate_competitive_participant();--> statement-breakpoint
-- Deferred because first-action locking precedes insertion of the action in its transaction.
CREATE FUNCTION app.validate_competitive_first_action() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE participant_row app.match_participants; action_row app.competitive_actions;
BEGIN
  SELECT * INTO participant_row FROM app.match_participants WHERE match_id=NEW.match_id AND user_id=NEW.user_id;
  IF participant_row.first_accepted_action_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO action_row FROM app.competitive_actions WHERE user_id=participant_row.user_id AND action_id=participant_row.first_accepted_action_id;
  IF NOT FOUND OR action_row.match_id IS DISTINCT FROM participant_row.match_id
    OR action_row.group_id IS DISTINCT FROM participant_row.locked_group_id
    OR action_row.account_build_version IS DISTINCT FROM participant_row.first_build_version+1
    OR action_row.state_before IS DISTINCT FROM participant_row.first_build_checkpoint THEN
    RAISE EXCEPTION 'first action must match participant and build checkpoint' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER validate_competitive_first_action AFTER INSERT OR UPDATE ON app.match_participants
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.validate_competitive_first_action();--> statement-breakpoint
CREATE FUNCTION app.validate_competitive_action() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE match_row app.matches; participant_row app.match_participants;
BEGIN
  SELECT * INTO STRICT match_row FROM app.matches WHERE match_id=NEW.match_id;
  SELECT * INTO STRICT participant_row FROM app.match_participants WHERE match_id=NEW.match_id AND user_id=NEW.user_id;
  IF NEW.group_id NOT IN (match_row.home_group_id,match_row.away_group_id)
    OR NEW.group_id IS DISTINCT FROM participant_row.locked_group_id
    OR NEW.snapshot_hash IS DISTINCT FROM match_row.rules_hash
    OR NEW.accepted_at < match_row.starts_at OR NEW.accepted_at >= match_row.ends_at
    OR match_row.state NOT IN ('scheduled','active') THEN
    RAISE EXCEPTION 'ledger does not match authoritative match or participant' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER validate_competitive_action BEFORE INSERT ON app.competitive_actions
  FOR EACH ROW EXECUTE FUNCTION app.validate_competitive_action();--> statement-breakpoint
CREATE FUNCTION app.protect_competitive_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'competitive audit history is append-only' USING ERRCODE='23514';
END $$;--> statement-breakpoint
CREATE TRIGGER protect_competitive_ledger BEFORE UPDATE OR DELETE ON app.competitive_actions
  FOR EACH ROW EXECUTE FUNCTION app.protect_competitive_history();--> statement-breakpoint
CREATE TRIGGER protect_competitive_receipts BEFORE UPDATE OR DELETE ON app.competitive_action_receipts
  FOR EACH ROW EXECUTE FUNCTION app.protect_competitive_history();--> statement-breakpoint
CREATE TRIGGER protect_competitive_checkpoints BEFORE UPDATE OR DELETE ON app.competitive_build_checkpoints
  FOR EACH ROW EXECUTE FUNCTION app.protect_competitive_history();
