CREATE TABLE IF NOT EXISTS "funded_wallets" (
  "address" text PRIMARY KEY NOT NULL,
  "tx_hash" text NOT NULL,
  "amount_usdc" text NOT NULL,
  "funded_at" timestamp with time zone DEFAULT now() NOT NULL
);
