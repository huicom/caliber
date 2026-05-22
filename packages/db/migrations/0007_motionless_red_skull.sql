CREATE TABLE "watchlist_webhooks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"webhook_url" text NOT NULL,
	"kind_filter" text DEFAULT '*' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_fired_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchlist_webhooks_webhook_url_unique" UNIQUE("webhook_url")
);
--> statement-breakpoint
CREATE INDEX "idx_webhooks_status" ON "watchlist_webhooks" USING btree ("status");