CREATE TABLE "job_drafts" (
	"draft_id" text PRIMARY KEY NOT NULL,
	"draft_hash" text NOT NULL,
	"chain_id" text DEFAULT 'arc' NOT NULL,
	"poster" text NOT NULL,
	"target_agent_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"budget_usdc" text NOT NULL,
	"min_tier" smallint NOT NULL,
	"min_confidence" smallint NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"onchain_job_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_job_drafts_poster" ON "job_drafts" USING btree ("poster");--> statement-breakpoint
CREATE INDEX "idx_job_drafts_hash" ON "job_drafts" USING btree ("draft_hash");