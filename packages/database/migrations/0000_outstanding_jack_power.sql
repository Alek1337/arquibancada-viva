CREATE SCHEMA "app";
--> statement-breakpoint
CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE TYPE "app"."outbox_status" AS ENUM('pending', 'publishing', 'published', 'failed');--> statement-breakpoint
CREATE TABLE "app"."match_sequences" (
	"match_id" uuid PRIMARY KEY NOT NULL,
	"last_sequence" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_sequences_last_sequence_nonnegative" CHECK ("app"."match_sequences"."last_sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."outbox_messages" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"event_type" text NOT NULL,
	"event_version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "app"."outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "outbox_messages_sequence_positive" CHECK ("app"."outbox_messages"."sequence" > 0),
	CONSTRAINT "outbox_messages_event_version_positive" CHECK ("app"."outbox_messages"."event_version" > 0),
	CONSTRAINT "outbox_messages_attempts_nonnegative" CHECK ("app"."outbox_messages"."attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_messages_aggregate_sequence_unique" ON "app"."outbox_messages" USING btree ("aggregate_type","aggregate_id","sequence");--> statement-breakpoint
CREATE INDEX "outbox_messages_dispatch_idx" ON "app"."outbox_messages" USING btree ("status","next_attempt_at");