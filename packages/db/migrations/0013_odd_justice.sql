CREATE TABLE "steward_specs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"spec_hash" text NOT NULL,
	"chain" text DEFAULT 'arc' NOT NULL,
	"buyer" text NOT NULL,
	"seller" text NOT NULL,
	"seller_url_hash" text,
	"schema_hash" text,
	"max_bytes" integer,
	"deadline_ms" integer,
	"require_json" boolean,
	"require_ok_field" boolean,
	"valid_until" timestamp with time zone,
	"nonce" numeric,
	"buyer_sig" text NOT NULL,
	"seller_sig" text,
	"raw_spec" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "steward_specs_spec_hash_unique" UNIQUE("spec_hash")
);
--> statement-breakpoint
ALTER TABLE "steward_payments" ADD COLUMN "spec_id" bigint;--> statement-breakpoint
ALTER TABLE "steward_payments" ADD COLUMN "verification_tier" smallint;--> statement-breakpoint
CREATE INDEX "idx_steward_specs_buyer" ON "steward_specs" USING btree ("buyer");--> statement-breakpoint
CREATE INDEX "idx_steward_specs_seller" ON "steward_specs" USING btree ("seller");--> statement-breakpoint
ALTER TABLE "steward_payments" ADD CONSTRAINT "steward_payments_spec_id_steward_specs_id_fk" FOREIGN KEY ("spec_id") REFERENCES "public"."steward_specs"("id") ON DELETE no action ON UPDATE no action;