CREATE TABLE "app"."idempotency_records" (
	"record_id" uuid PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"key_hash" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_records_scope_nonempty" CHECK (length("app"."idempotency_records"."scope") > 0),
	CONSTRAINT "idempotency_records_key_hash_length" CHECK (length("app"."idempotency_records"."key_hash") = 64),
	CONSTRAINT "idempotency_records_request_hash_length" CHECK (length("app"."idempotency_records"."request_hash") = 64),
	CONSTRAINT "idempotency_records_expiry_after_creation" CHECK ("app"."idempotency_records"."expires_at" > "app"."idempotency_records"."created_at"),
	CONSTRAINT "idempotency_records_completion_consistent" CHECK (("app"."idempotency_records"."completed_at" is null and "app"."idempotency_records"."response" is null) or ("app"."idempotency_records"."completed_at" is not null and "app"."idempotency_records"."response" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_records_scope_key_unique" ON "app"."idempotency_records" USING btree ("scope","key_hash");--> statement-breakpoint
CREATE INDEX "idempotency_records_expiry_idx" ON "app"."idempotency_records" USING btree ("expires_at");