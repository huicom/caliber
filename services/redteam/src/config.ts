// Env loading + validation for the red-team fixture. Fails loudly on missing
// addresses (the whole point of the fixture is that payments settle to a known
// "seller" or "attacker" address). The admin token gets a random default if
// unset, logged once at startup.

import { randomBytes } from 'node:crypto';

function req(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(
      `[redteam] missing required env ${name} — set it in the repo-root .env (see .env.example)`,
    );
  }
  return v;
}

let _generatedToken: string | null = null;

/**
 * A KNOWN OFAC-sanctioned address (verified `isSanctioned → true` against the
 * Chainalysis on-chain oracle) used by the `sanctioned` demo mode so Steward's
 * OFAC SDN screen fires on camera. Overridable via REDTEAM_SANCTIONED_ADDRESS.
 */
const DEFAULT_SANCTIONED_ADDRESS = '0x098B716B8Aaf21512996dC57EB0615e2383E2f96';

export interface RedteamConfig {
  port: number;
  sellerAddress: string;
  attackerAddress: string;
  /** Recipient for the `sanctioned` demo mode — a known OFAC-sanctioned address. */
  sanctionedAddress: string;
  adminToken: string;
  /** True if the admin token was randomly generated (so we log it once). */
  adminTokenGenerated: boolean;
  facilitatorUrl: string;
  chainId: string;
}

export function loadConfig(): RedteamConfig {
  const port = Number(process.env.REDTEAM_PORT ?? '3400');
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`[redteam] REDTEAM_PORT must be a positive integer, got ${process.env.REDTEAM_PORT}`);
  }

  let adminToken = process.env.REDTEAM_ADMIN_TOKEN?.trim();
  let adminTokenGenerated = false;
  if (!adminToken) {
    if (!_generatedToken) _generatedToken = randomBytes(24).toString('hex');
    adminToken = _generatedToken;
    adminTokenGenerated = true;
  }

  return {
    port,
    sellerAddress: req('REDTEAM_SELLER_ADDRESS'),
    attackerAddress: req('REDTEAM_ATTACKER_ADDRESS'),
    sanctionedAddress:
      process.env.REDTEAM_SANCTIONED_ADDRESS?.trim() || DEFAULT_SANCTIONED_ADDRESS,
    adminToken,
    adminTokenGenerated,
    facilitatorUrl: process.env.X402_FACILITATOR_URL ?? 'https://gateway-api-testnet.circle.com',
    chainId: process.env.ARC_CHAIN_ID ?? '5042002',
  };
}
