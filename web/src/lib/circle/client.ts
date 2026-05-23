// Server-side Circle Developer-Controlled Wallets client for the
// "demo without MetaMask" path on /jobs/new. Single Caliber-owned
// wallet set houses one EOA per browser session — judges get a real
// on-chain wallet without installing anything, and can walk the full
// Caliber-gated post-job flow end-to-end.
//
// Required env vars (see .env.example):
//   CIRCLE_API_KEY              — issued by Circle Developer Console
//   CIRCLE_ENTITY_SECRET        — 32-byte hex, generated + registered once
//   CIRCLE_DEMO_WALLET_SET_ID   — UUID of the Caliber demo wallet set

import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';

let _client: ReturnType<typeof initiateDeveloperControlledWalletsClient> | null = null;

export function getCircleClient() {
  if (_client) return _client;
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) {
    throw new Error(
      'CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET must be set. See web/src/lib/circle/README.md for setup.',
    );
  }
  _client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
  return _client;
}

export function getDemoWalletSetId(): string {
  const id = process.env.CIRCLE_DEMO_WALLET_SET_ID;
  if (!id) {
    throw new Error(
      'CIRCLE_DEMO_WALLET_SET_ID must be set (create one with `createWalletSet` first; see README).',
    );
  }
  return id;
}

/** Caliber-owned wallet that funds every new demo wallet at creation
 * time. Admin tops it up manually via https://faucet.circle.com when low.
 * Set via web/scripts/create-treasury-wallet.ts. */
export function getDemoTreasuryWalletId(): string | null {
  return process.env.CIRCLE_DEMO_TREASURY_WALLET_ID || null;
}

// All Caliber demo wallets live on Arc Testnet. Circle's blockchain code
// for it is ARC-TESTNET (chain id 5042002).
export const DEMO_BLOCKCHAIN = 'ARC-TESTNET' as const;
