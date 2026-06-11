CREATE TABLE "broker_matches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"requester_addr" text NOT NULL,
	"job_id" bigint,
	"provider_id" bigint,
	"status" text NOT NULL,
	"fee_usdc" numeric(18, 6),
	"bond_usdc" numeric(18, 6),
	"bond_id" bigint,
	"attestations_bought" integer DEFAULT 0 NOT NULL,
	"decline_reason" text,
	"decision_log" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_broker_matches_created_at" ON "broker_matches" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_broker_matches_status" ON "broker_matches" USING btree ("status");