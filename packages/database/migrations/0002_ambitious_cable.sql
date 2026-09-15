CREATE TABLE "app"."queue_fixture_effects" (
	"effect_id" uuid PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"job_name" text NOT NULL,
	"job_version" smallint NOT NULL,
	"correlation_id" uuid NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "queue_fixture_effects_job_version_positive" CHECK ("app"."queue_fixture_effects"."job_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "queue_fixture_effects_job_id_unique" ON "app"."queue_fixture_effects" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "queue_fixture_effects_correlation_idx" ON "app"."queue_fixture_effects" USING btree ("correlation_id");