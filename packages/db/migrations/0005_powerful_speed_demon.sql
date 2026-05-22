CREATE TABLE "tier_transitions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"chain_id" text DEFAULT 'arc' NOT NULL,
	"agent_id" bigint NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"from_tier" text,
	"to_tier" text NOT NULL,
	"from_flags" smallint,
	"to_flags" smallint NOT NULL,
	"from_score" smallint,
	"to_score" smallint,
	"methodology_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rating_snapshots" ADD COLUMN "flags" smallint;--> statement-breakpoint
CREATE INDEX "idx_transitions_at" ON "tier_transitions" USING btree ("at");--> statement-breakpoint
CREATE INDEX "idx_transitions_agent" ON "tier_transitions" USING btree ("agent_id","at");--> statement-breakpoint
CREATE INDEX "idx_transitions_kind" ON "tier_transitions" USING btree ("kind","at");