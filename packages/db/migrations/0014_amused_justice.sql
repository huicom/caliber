CREATE TABLE "steward_evidence" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"payment_id" bigint,
	"spec_hash" text,
	"response_hash" text,
	"agent_id" bigint,
	"verdict" smallint,
	"verifying_tier" smallint,
	"buyer_sig" text,
	"seller_sig" text,
	"methodology_version" text,
	"attestation" jsonb,
	"signature" text,
	"onchain_tx" text,
	"feedback_event_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "steward_evidence" ADD CONSTRAINT "steward_evidence_payment_id_steward_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."steward_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_steward_evidence_payment" ON "steward_evidence" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "idx_steward_evidence_agent" ON "steward_evidence" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_steward_evidence_created_at" ON "steward_evidence" USING btree ("created_at");