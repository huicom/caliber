CREATE TABLE "steward_approvals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"payment_id" bigint NOT NULL,
	"incident_id" bigint,
	"status" text DEFAULT 'pending' NOT NULL,
	"telegram_chat_id" text,
	"telegram_message_id" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_via" text
);
--> statement-breakpoint
CREATE TABLE "steward_counterparties" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"pay_to" text NOT NULL,
	"host" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"registered" boolean DEFAULT false NOT NULL,
	"trusted" boolean DEFAULT false NOT NULL,
	"sdn_result" jsonb,
	"sdn_checked_at" timestamp with time zone,
	"payment_count" integer DEFAULT 0 NOT NULL,
	"total_usdc" numeric(18, 6) DEFAULT '0' NOT NULL,
	"price_median_usdc" numeric(18, 6),
	CONSTRAINT "steward_counterparties_pay_to_unique" UNIQUE("pay_to")
);
--> statement-breakpoint
CREATE TABLE "steward_incidents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"host" text,
	"pay_to" text,
	"payment_id" bigint,
	"evidence" jsonb,
	"narrative" text,
	"resolved_at" timestamp with time zone,
	"resolved_by" text
);
--> statement-breakpoint
CREATE TABLE "steward_integrations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"api_key_hash" text NOT NULL,
	"payer_class" text DEFAULT 'external' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "steward_integrations_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "steward_mandates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"raw_text" text NOT NULL,
	"compiled_policy" jsonb NOT NULL,
	"compile_model" text,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "steward_payments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" text NOT NULL,
	"source" text NOT NULL,
	"seller_url" text NOT NULL,
	"host" text NOT NULL,
	"pay_to" text,
	"quoted_usdc" numeric(18, 6),
	"settled_usdc" numeric(18, 6),
	"decision" text NOT NULL,
	"decision_stage" text NOT NULL,
	"reasoning" text,
	"detector_hits" jsonb,
	"sdn_source" text,
	"sdn_checked_at" timestamp with time zone,
	"sdn_result" jsonb,
	"caliber_score" smallint,
	"llm_model" text,
	"payment_ref" text,
	"settle_status" text,
	"mandate_id" bigint,
	"incident_id" bigint,
	"latency_ms" integer,
	CONSTRAINT "steward_payments_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "steward_payments_payment_ref_unique" UNIQUE("payment_ref")
);
--> statement-breakpoint
CREATE TABLE "steward_routes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"host" text NOT NULL,
	"path_prefix" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"paused_reason" text,
	"paused_at" timestamp with time zone,
	"auto_resume_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "steward_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "steward_approvals" ADD CONSTRAINT "steward_approvals_payment_id_steward_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."steward_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "steward_approvals" ADD CONSTRAINT "steward_approvals_incident_id_steward_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."steward_incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "steward_incidents" ADD CONSTRAINT "steward_incidents_payment_id_steward_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."steward_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "steward_payments" ADD CONSTRAINT "steward_payments_mandate_id_steward_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."steward_mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_steward_incidents_created_at" ON "steward_incidents" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_steward_incidents_status" ON "steward_incidents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_steward_payments_created_at" ON "steward_payments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_steward_payments_host" ON "steward_payments" USING btree ("host");--> statement-breakpoint
CREATE INDEX "idx_steward_payments_decision" ON "steward_payments" USING btree ("decision");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_steward_routes_host_path" ON "steward_routes" USING btree ("host","path_prefix");