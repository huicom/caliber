// Env loading + validation for the Steward service. Fails loudly on the wallet
// key and API key (both are load-bearing: no key → can't sign / can't auth).

import type { Hex } from 'viem';

function req(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(
      `[steward] missing required env ${name} — set it in the repo-root .env (see .env.example)`,
    );
  }
  return v;
}

export interface StewardConfig {
  port: number;
  /** Header `x-steward-key` must equal this to call POST /v1/pay. */
  apiKey: string;
  /** Buyer wallet. Production should use a dedicated key, NOT the test funder. */
  privateKey: Hex;
  /** Per-tx cap (stand-in policy until the policy engine lands), decimal USDC. */
  maxTxUsdc: number;
}

export function loadConfig(): StewardConfig {
  const port = Number(process.env.STEWARD_PORT ?? '3300');
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`[steward] STEWARD_PORT must be a positive integer, got ${process.env.STEWARD_PORT}`);
  }

  const maxTxUsdc = Number(process.env.STEWARD_MAX_TX_USDC ?? '0.005');
  if (!Number.isFinite(maxTxUsdc) || maxTxUsdc < 0) {
    throw new Error(`[steward] STEWARD_MAX_TX_USDC must be a non-negative number, got ${process.env.STEWARD_MAX_TX_USDC}`);
  }

  let privateKey = req('STEWARD_PRIVATE_KEY');
  if (!privateKey.startsWith('0x')) privateKey = `0x${privateKey}`;

  return {
    port,
    apiKey: req('STEWARD_API_KEY'),
    privateKey: privateKey as Hex,
    maxTxUsdc,
  };
}
