// Circle Gateway x402 middleware for Caliber attestation endpoints.
//
// Migrated from the homegrown on-chain-proof variant to Circle's official
// @circle-fin/x402-batching/server SDK (see Circle blog post 2026-05-18).
//
// Flow:
//   1. Client POSTs without payment. createGatewayMiddleware returns 402 +
//      a Circle-formatted payment requirements payload.
//   2. Client signs an EIP-3009 TransferWithAuthorization off-chain against
//      the GatewayWallet contract (NOT against USDC directly — payments
//      route through Circle's batched-settlement infrastructure).
//   3. Client retries with the signed payload in the X-PAYMENT header.
//   4. Middleware calls Circle's hosted facilitator
//      (gateway-api-testnet.circle.com) to verify the signature + settle
//      the payment. Verified → request flows through to attestRoute.
//
// Settlement details:
//   - Payments accumulate in the Seller Wallet's Gateway Balance
//     (Circle-custodied, not on-chain).
//   - Withdraw to a Payout Wallet via `circle gateway withdraw` on the
//     cadence the seller chooses (per-tx, daily, threshold-based, etc.).
//
// Server-to-server bypass remains for trusted infra (Circle demo path,
// Sentinel, AI route) — same X-X402-BYPASS shared-secret pattern.

import type { Request, Response, NextFunction } from 'express';
import { createGatewayMiddleware, type GatewayMiddleware } from '@circle-fin/x402-batching/server';

// Network identifier in CAIP-2 form. Arc Testnet = eip155:5042002.
const ARC_TESTNET_NETWORK = 'eip155:5042002';

// Price per attestation. Circle Gateway accepts dollar strings ("$0.001")
// or decimal strings ("0.001"). Default 0.001 USDC = 1000 microUSDC,
// matching the on-chain variant we shipped first.
const PRICE = process.env.X402_PRICE_USDC ?? '$0.001';

// Seller Wallet address — receives revenue in its Gateway Balance.
// Provision via `circle wallet create` and add to .env. Until set, the
// middleware refuses to initialise and the endpoint returns 503.
const SELLER_ADDRESS = process.env.X402_SELLER_ADDRESS;

// Hosted facilitator — testnet for Arc Testnet, mainnet for production.
const FACILITATOR_URL =
  process.env.X402_FACILITATOR_URL ?? 'https://gateway-api-testnet.circle.com';

let _gateway: GatewayMiddleware | null = null;
function getGateway(): GatewayMiddleware {
  if (_gateway) return _gateway;
  if (!SELLER_ADDRESS) {
    throw new Error(
      'X402_SELLER_ADDRESS not set — provision with `circle wallet create --type agent --chain ARC-TESTNET` then add to .env',
    );
  }
  _gateway = createGatewayMiddleware({
    sellerAddress: SELLER_ADDRESS,
    facilitatorUrl: FACILITATOR_URL,
    networks: [ARC_TESTNET_NETWORK],
    description: 'Caliber signed rating attestation',
  });
  return _gateway;
}

/**
 * Express middleware wrapping Circle Gateway's `gateway.require()` paywall.
 * Mounted in front of POST /v1/agents/:chain/:id/attest. Trusted
 * server-to-server callers can bypass via the X-X402-BYPASS shared secret.
 */
export async function x402Middleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.method === 'OPTIONS') {
    next();
    return;
  }

  // Server-to-server bypass for trusted infrastructure.
  const bypass = req.headers['x-x402-bypass'];
  const expected = process.env.X402_BYPASS_TOKEN;
  if (expected && typeof bypass === 'string' && bypass === expected) {
    next();
    return;
  }

  let gw: GatewayMiddleware;
  try {
    gw = getGateway();
  } catch (e) {
    res.status(503).json({
      error: 'x402_not_configured',
      message: e instanceof Error ? e.message : 'Gateway middleware unavailable',
    });
    return;
  }

  // Delegate to Circle's middleware. It handles the 402 emission,
  // payment header parsing, facilitator verification, and settlement.
  const requirePayment = gw.require(PRICE);
  // Cast req/res to the Circle SDK's narrower types (PaymentRequest/Response
  // extend Express's IncomingMessage/ServerResponse).
  await requirePayment(req as unknown as Parameters<typeof requirePayment>[0], res as unknown as Parameters<typeof requirePayment>[1], next);
}
