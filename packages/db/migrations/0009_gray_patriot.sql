CREATE TABLE "hirebot_decisions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"job_id" bigint,
	"provider_id" bigint,
	"action" text NOT NULL,
	"rationale" text NOT NULL,
	"cost_usdc" numeric(18, 6) DEFAULT '0' NOT NULL,
	"budget_left" numeric(18, 6) NOT NULL,
	"tier" text,
	"score" smallint,
	"payment_ref" text
);
--> statement-breakpoint
CREATE INDEX "idx_hirebot_created_at" ON "hirebot_decisions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_hirebot_provider" ON "hirebot_decisions" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "idx_hirebot_action" ON "hirebot_decisions" USING btree ("action");