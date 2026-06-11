-- Lepton Phase 1 (A2): metered payments ledger + refund queue.
--
-- NOTE: drizzle also wanted to emit `CREATE TABLE funded_wallets` and
-- `ALTER TABLE job_drafts ADD COLUMN bond_required` here, because those two
-- changes were applied to the live DB via hand-written migration files
-- (0008_bond_required.sql, 0009_funded_wallets.sql) that were never recorded
-- in drizzle's _journal.json. Both already exist in the database, so those
-- statements are intentionally omitted from this file to avoid "already exists"
-- errors. The 0008 snapshot still records the full, correct desired state.
CREATE TABLE IF NOT EXISTS "metered_payments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payer_address" text NOT NULL,
	"payer_class" text NOT NULL,
	"endpoint" text NOT NULL,
	"agent_id" bigint,
	"amount_usdc" numeric(18, 6) NOT NULL,
	"payment_ref" text NOT NULL,
	"latency_ms" integer,
	"status" text DEFAULT 'settled' NOT NULL,
	CONSTRAINT "metered_payments_payment_ref_unique" UNIQUE("payment_ref")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "metered_refund_queue" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payer_address" text NOT NULL,
	"amount_usdc" numeric(18, 6) NOT NULL,
	"payment_ref" text NOT NULL,
	"reason" text NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_metered_payments_created_at" ON "metered_payments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_metered_payments_payer" ON "metered_payments" USING btree ("payer_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_metered_payments_class" ON "metered_payments" USING btree ("payer_class");
