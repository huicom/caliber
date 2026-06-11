// Circle Gateway x402 middleware for Caliber's metered endpoints.
//
// Lepton Phase 1 (A1): generalized + instrumented. The Circle batched-settlement
// middleware (createGatewayMiddleware from @circle-fin/x402-batching/server) still
// does all the protocol work — 402 emission, payment-header parsing, facilitator
// verify + settle. We wrap it to:
//   1. Support more than one gated route, each with its own price + recipient
//      (the broker's fee endpoint in Phase 2 reuses this with the broker as payTo).
//   2. Record every request that passes the gate into the `metered_payments`
//      ledger (honest traction, Guardrail 4) — paid OR bypassed.
//   3. Reject replayed payment references at our layer via the ledger's UNIQUE
//      key (the facilitator is the authoritative replay guard via EIP-3009
//      nonces; this is our defence-in-depth record).
//   4. Enqueue a refund row when settlement succeeds but the downstream handler
//      fails (5xx) — we never silently keep funds.
//
// After `gateway.require(price)` passes, the Circle SDK attaches `req.payment`:
//   { verified, payer, amount (microUSDC string), network, transaction (settle ref) }
//
// Server-to-server bypass (Circle demo path, Sentinel, AI route) still skips the
// toll via the X-X402-BYPASS shared secret — recorded as `internal`, amount 0.

import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import {
  createGatewayMiddleware,
  type GatewayMiddleware,
  type PaymentRequest,
} from '@circle-fin/x402-batching/server';
import {
  db,
  meteredPayments,
  meteredRefundQueue,
  classifyPayer,
  type PayerClass,
} from '@arc-agents/db';

// Network identifier in CAIP-2 form. Arc Testnet = eip155:5042002.
const ARC_TESTNET_NETWORK = 'eip155:5042002';

// Default price per call. Circle Gateway accepts dollar strings ("$0.001").
const DEFAULT_PRICE = process.env.X402_PRICE_USDC ?? '$0.001';

// Default recipient — the Caliber revenue (Seller) wallet.
const DEFAULT_RECIPIENT = process.env.X402_SELLER_ADDRESS;

// Hosted facilitator — testnet for Arc Testnet, mainnet for production.
const FACILITATOR_URL =
  process.env.X402_FACILITATOR_URL ?? 'https://gateway-api-testnet.circle.com';

// One GatewayMiddleware per recipient address (the broker fee endpoint uses a
// different payTo than the attestation endpoint).
const _gateways = new Map<string, GatewayMiddleware>();
function getGateway(recipient: string | undefined): GatewayMiddleware {
  const seller = recipient ?? DEFAULT_RECIPIENT;
  if (!seller) {
    throw new Error(
      'No x402 recipient — set X402_SELLER_ADDRESS (or pass a recipient) and provision via `circle wallet create --chain ARC-TESTNET`',
    );
  }
  const cached = _gateways.get(seller);
  if (cached) return cached;
  const gw = createGatewayMiddleware({
    sellerAddress: seller,
    facilitatorUrl: FACILITATOR_URL,
    networks: [ARC_TESTNET_NETWORK],
    description: 'Caliber metered API',
  });
  _gateways.set(seller, gw);
  return gw;
}

/** microUSDC integer string → decimal USDC string for numeric(18,6). */
function microToUsdc(micro: string | undefined): string {
  if (!micro) return '0';
  const n = Number(micro);
  if (!Number.isFinite(n)) return '0';
  return (n / 1_000_000).toFixed(6);
}

function agentIdFromReq(req: Request): bigint | null {
  const raw = req.params?.id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (id && /^\d+$/.test(id)) {
    try {
      return BigInt(id);
    } catch {
      return null;
    }
  }
  return null;
}

interface MeteredContext {
  bypass: boolean;
  payer: string;
  payerClass: PayerClass;
  amountUsdc: string;
  paymentRef: string;
  recorded?: boolean;
}

// Stash our per-request accounting on the request object.
type MeteredRequest = Request & { metered?: MeteredContext; payment?: PaymentRequest['payment'] };

export interface MeteredGateOptions {
  /** Stable label for the ledger `endpoint` column, e.g. 'attest' | 'broker_fee'. */
  endpoint: string;
  /** Price string ("$0.001"). Defaults to X402_PRICE_USDC. */
  price?: string;
  /** Recipient (payTo). Defaults to X402_SELLER_ADDRESS. */
  recipient?: string;
}

/**
 * Insert one ledger row for a gated request once the response is finishing.
 * Fire-and-forget: never block or break the response. Idempotent on payment_ref.
 */
async function recordOutcome(
  ctx: MeteredContext,
  opts: MeteredGateOptions,
  agentId: bigint | null,
  statusCode: number,
  latencyMs: number,
): Promise<void> {
  if (ctx.recorded) return;
  ctx.recorded = true;

  // A 5xx after a real settlement means we took funds but failed to deliver —
  // queue a refund. 4xx (e.g. 422 unrated) is a legitimate, billable answer.
  const settledButFailed = !ctx.bypass && statusCode >= 500;
  const status = ctx.bypass ? 'bypass' : settledButFailed ? 'refund_pending' : 'settled';

  try {
    await db
      .insert(meteredPayments)
      .values({
        payerAddress: ctx.payer,
        payerClass: ctx.payerClass,
        endpoint: opts.endpoint,
        agentId,
        amountUsdc: ctx.amountUsdc,
        paymentRef: ctx.paymentRef,
        latencyMs,
        status,
      })
      .onConflictDoNothing({ target: meteredPayments.paymentRef });

    if (settledButFailed) {
      await db.insert(meteredRefundQueue).values({
        payerAddress: ctx.payer,
        amountUsdc: ctx.amountUsdc,
        paymentRef: ctx.paymentRef,
        reason: `downstream ${statusCode} after settle on ${opts.endpoint}`,
      });
    }
  } catch (err) {
    console.error('[metered] ledger insert failed:', err instanceof Error ? err.message : err);
  }

  // Structured one-line log per gated request.
  console.log(
    `[metered] ${opts.endpoint} class=${ctx.payerClass} payer=${ctx.payer.slice(0, 10)}… ` +
      `amount=${ctx.amountUsdc} agent=${agentId ?? '-'} http=${statusCode} ${latencyMs}ms ref=${ctx.paymentRef}`,
  );
}

/**
 * Factory: an Express middleware that gates a route with Circle Gateway x402,
 * records the outcome to the ledger, and forwards `req.payment` to the handler.
 */
export function meteredGate(opts: MeteredGateOptions) {
  const price = opts.price ?? DEFAULT_PRICE;

  return async function gate(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (req.method === 'OPTIONS') {
      next();
      return;
    }

    const mreq = req as MeteredRequest;
    const start = Date.now();
    const agentId = agentIdFromReq(req);

    // Arrange the ledger write for when the response finishes — covers both
    // the bypass and paid paths, and captures the final status + latency.
    res.on('finish', () => {
      const ctx = mreq.metered;
      if (!ctx) return; // gate refused before establishing context (e.g. 402/503)
      void recordOutcome(ctx, opts, agentId, res.statusCode, Date.now() - start);
    });

    // Server-to-server bypass for trusted infrastructure.
    const bypass = req.headers['x-x402-bypass'];
    const expected = process.env.X402_BYPASS_TOKEN;
    if (expected && typeof bypass === 'string' && bypass === expected) {
      mreq.metered = {
        bypass: true,
        payer: '0x0000000000000000000000000000000000000000',
        payerClass: classifyPayer(null, { bypass: true }),
        amountUsdc: '0',
        paymentRef: `internal:${randomUUID()}`,
      };
      next();
      return;
    }

    let gw: GatewayMiddleware;
    try {
      gw = getGateway(opts.recipient);
    } catch (e) {
      res.status(503).json({
        error: 'x402_not_configured',
        message: e instanceof Error ? e.message : 'Gateway middleware unavailable',
      });
      return;
    }

    // Delegate to Circle's middleware. On a successful verify+settle it attaches
    // `req.payment` and calls our wrapped next(); on failure it emits the 402.
    const requirePayment = gw.require(price);
    const wrappedNext: NextFunction = (err?: unknown) => {
      if (err) {
        next(err);
        return;
      }
      const pay = mreq.payment;
      const payer = pay?.payer ?? '0x0000000000000000000000000000000000000000';
      mreq.metered = {
        bypass: false,
        payer,
        payerClass: classifyPayer(payer),
        amountUsdc: microToUsdc(pay?.amount),
        // Settle reference is the unique ledger key. Fall back to a synthetic
        // value so a missing ref can never collapse distinct rows together.
        paymentRef: pay?.transaction || `settle-missing:${randomUUID()}`,
      };
      next();
    };

    await requirePayment(
      req as unknown as Parameters<typeof requirePayment>[0],
      res as unknown as Parameters<typeof requirePayment>[1],
      wrappedNext as unknown as Parameters<typeof requirePayment>[2],
    );
  };
}

/**
 * Backward-compatible export: the attestation paywall. Same behavior as before
 * (price = X402_PRICE_USDC, recipient = X402_SELLER_ADDRESS) plus ledger
 * instrumentation. Mounted in front of POST /v1/agents/:chain/:id/attest.
 */
export const x402Middleware = meteredGate({ endpoint: 'attest' });
