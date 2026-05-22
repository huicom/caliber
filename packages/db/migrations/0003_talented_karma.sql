CREATE TABLE "rating_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"chain_id" text DEFAULT 'arc' NOT NULL,
	"agent_id" bigint NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"tier" text NOT NULL,
	"ppd_30d" numeric(8, 6),
	"lgd" numeric(8, 6),
	"ead_usdc" text,
	"confidence" text NOT NULL,
	"view" text NOT NULL,
	"methodology_version" text NOT NULL,
	"interaction_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_snapshots_agent_day" ON "rating_snapshots" USING btree ("agent_id","computed_at");--> statement-breakpoint
CREATE INDEX "idx_snapshots_computed_at" ON "rating_snapshots" USING btree ("computed_at");--> statement-breakpoint
CREATE INDEX "idx_snapshots_chain_agent" ON "rating_snapshots" USING btree ("chain_id","agent_id");