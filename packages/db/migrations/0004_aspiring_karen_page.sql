ALTER TABLE "agents" ADD COLUMN "category" text;--> statement-breakpoint
CREATE INDEX "idx_agents_category" ON "agents" USING btree ("category");