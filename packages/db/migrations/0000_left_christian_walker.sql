CREATE TABLE "agents" (
	"agent_id" bigint PRIMARY KEY NOT NULL,
	"owner_address" text NOT NULL,
	"metadata_uri" text,
	"metadata" jsonb,
	"name" text,
	"agent_type" text,
	"capabilities" jsonb,
	"reputation_score" numeric(10, 2),
	"feedback_count" integer DEFAULT 0 NOT NULL,
	"validation_status" text,
	"jobs_completed" integer DEFAULT 0 NOT NULL,
	"usdc_earned" numeric(30, 6) DEFAULT '0' NOT NULL,
	"registered_at_block" bigint NOT NULL,
	"registered_tx_hash" text NOT NULL,
	"registered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"agent_id" bigint NOT NULL,
	"validator_address" text NOT NULL,
	"score" numeric(10, 2) NOT NULL,
	"score_type" integer,
	"tag" text,
	"feedback_hash" text,
	"block_number" bigint NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_events_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
CREATE TABLE "indexer_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_id" bigint NOT NULL,
	"event_type" text NOT NULL,
	"actor_address" text NOT NULL,
	"block_number" bigint NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_events_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"job_id" bigint PRIMARY KEY NOT NULL,
	"client_address" text NOT NULL,
	"provider_address" text NOT NULL,
	"evaluator_address" text,
	"budget_usdc" numeric(30, 6),
	"budget_raw" text,
	"description" text,
	"status" text NOT NULL,
	"deliverable_hash" text,
	"completion_reason" text,
	"expired_at" timestamp with time zone,
	"created_at_block" bigint NOT NULL,
	"created_tx_hash" text NOT NULL,
	"completed_at_block" bigint,
	"completed_tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"agent_id" bigint NOT NULL,
	"validator_address" text NOT NULL,
	"request_hash" text NOT NULL,
	"request_uri" text,
	"tag" text,
	"status" text NOT NULL,
	"response_code" integer,
	"response_uri" text,
	"response_hash" text,
	"requested_at_block" bigint NOT NULL,
	"responded_at_block" bigint,
	"request_tx_hash" text NOT NULL,
	"response_tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "validations_request_hash_unique" UNIQUE("request_hash")
);
--> statement-breakpoint
ALTER TABLE "feedback_events" ADD CONSTRAINT "feedback_events_agent_id_agents_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_jobs_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("job_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validations" ADD CONSTRAINT "validations_agent_id_agents_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agents_owner" ON "agents" USING btree ("owner_address");--> statement-breakpoint
CREATE INDEX "idx_agents_reputation" ON "agents" USING btree ("reputation_score");--> statement-breakpoint
CREATE INDEX "idx_agents_earned" ON "agents" USING btree ("usdc_earned");--> statement-breakpoint
CREATE INDEX "idx_agents_block" ON "agents" USING btree ("registered_at_block");--> statement-breakpoint
CREATE INDEX "idx_agents_name" ON "agents" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_agents_capabilities_gin" ON "agents" USING gin ("capabilities");--> statement-breakpoint
CREATE INDEX "idx_agents_metadata_gin" ON "agents" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_feedback_agent" ON "feedback_events" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_feedback_block" ON "feedback_events" USING btree ("block_number");--> statement-breakpoint
CREATE INDEX "idx_feedback_validator" ON "feedback_events" USING btree ("validator_address");--> statement-breakpoint
CREATE INDEX "idx_job_events_job" ON "job_events" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_job_events_block" ON "job_events" USING btree ("block_number");--> statement-breakpoint
CREATE INDEX "idx_job_events_type" ON "job_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_jobs_provider" ON "jobs" USING btree ("provider_address");--> statement-breakpoint
CREATE INDEX "idx_jobs_client" ON "jobs" USING btree ("client_address");--> statement-breakpoint
CREATE INDEX "idx_jobs_status" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_jobs_block" ON "jobs" USING btree ("created_at_block");--> statement-breakpoint
CREATE INDEX "idx_jobs_budget" ON "jobs" USING btree ("budget_usdc");--> statement-breakpoint
CREATE INDEX "idx_validations_agent" ON "validations" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_validations_status" ON "validations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_validations_validator" ON "validations" USING btree ("validator_address");