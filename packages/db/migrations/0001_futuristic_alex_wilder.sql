ALTER TABLE "agents" ADD COLUMN "chain_id" text DEFAULT 'arc' NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_events" ADD COLUMN "chain_id" text DEFAULT 'arc' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_events" ADD COLUMN "chain_id" text DEFAULT 'arc' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "chain_id" text DEFAULT 'arc' NOT NULL;--> statement-breakpoint
ALTER TABLE "validations" ADD COLUMN "chain_id" text DEFAULT 'arc' NOT NULL;