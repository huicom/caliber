// Broker HTTP API (Lepton Phase 2). The console calls /match; the requester
// pays the broker fee through /fee (a real x402 nanopayment — the first hop of
// the payment chain). /matches + /bonds back the console's reasoning stream and
// bond board.

import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import { createGatewayMiddleware } from '@circle-fin/x402-batching/server';
import { db, sql, meteredPayments, classifyPayer } from '@arc-agents/db';
import { config } from './config.js';
import { runMatch, type MatchRequest } from './match.js';
import { brokerAddress } from './chain.js';

const app = express();

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-PAYMENT, Payment-Signature, x-x402-bypass');
  res.setHeader('Access-Control-Expose-Headers', 'X-PAYMENT-RESPONSE, PAYMENT-REQUIRED, PAYMENT-RESPONSE');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});
app.use(express.json({ limit: '64kb' }));

// ---- x402 fee gate (requester → broker) -------------------------------------
// Lazy: only built if the broker key is set. Charges a flat floor fee; the
// value-scaled fee is recorded against the match. Records the nanopayment to
// the shared metered_payments ledger (endpoint='broker_fee').
type GatewayReq = Request & { payment?: { payer: string; amount: string; transaction?: string } };
let feeGate: ((req: Request, res: Response, next: NextFunction) => void) | null = null;
function getFeeGate() {
  if (feeGate) return feeGate;
  const gw = createGatewayMiddleware({
    sellerAddress: brokerAddress(),
    facilitatorUrl: process.env.X402_FACILITATOR_URL ?? 'https://gateway-api-testnet.circle.com',
    networks: [`eip155:${config.chainId}`],
    description: 'Caliber Labs Broker fee',
  });
  feeGate = gw.require(`$${config.feeMinUsdc}`);
  return feeGate!;
}

app.post('/fee', (req, res, next) => {
  try {
    getFeeGate()(req, res, next);
  } catch (e) {
    res.status(503).json({ error: 'fee_gate_unavailable', message: e instanceof Error ? e.message : 'unavailable' });
  }
}, async (req: Request, res: Response) => {
  const pay = (req as GatewayReq).payment;
  if (pay?.transaction) {
    try {
      await db.insert(meteredPayments).values({
        payerAddress: pay.payer, payerClass: classifyPayer(pay.payer), endpoint: 'broker_fee',
        amountUsdc: (Number(pay.amount) / 1_000_000).toFixed(6), paymentRef: pay.transaction, status: 'settled',
      }).onConflictDoNothing({ target: meteredPayments.paymentRef });
    } catch (e) {
      console.error('[broker] fee ledger insert failed:', e instanceof Error ? e.message : e);
    }
  }
  res.json({ ok: true, payment: pay ? { amountUsdc: (Number(pay.amount) / 1_000_000).toFixed(6), txRef: pay.transaction } : null });
});

// ---- match ------------------------------------------------------------------

app.post('/match', async (req: Request, res: Response) => {
  const b = req.body ?? {};
  if (typeof b.jobValueUsdc !== 'number' || !b.requesterAddr) {
    res.status(400).json({ error: 'invalid_body', message: 'requesterAddr and jobValueUsdc are required' });
    return;
  }
  const reqObj: MatchRequest = {
    requesterAddr: String(b.requesterAddr),
    jobValueUsdc: Number(b.jobValueUsdc),
    category: b.category, query: b.query, minTier: b.minTier,
    maxFeeUsdc: typeof b.maxFeeUsdc === 'number' ? b.maxFeeUsdc : undefined,
    jobId: b.jobId ? String(b.jobId) : undefined,
  };
  try {
    const result = await runMatch(reqObj);
    res.json(result);
  } catch (e) {
    console.error('[broker] match error:', e);
    res.status(500).json({ error: 'match_failed', message: e instanceof Error ? e.message : 'error' });
  }
});

// ---- reads ------------------------------------------------------------------

app.get('/matches', async (_req: Request, res: Response) => {
  const rows = await sql`
    SELECT id::text AS id, created_at, requester_addr, job_id::text AS job_id,
           provider_id::text AS provider_id, status, fee_usdc, bond_usdc,
           bond_id::text AS bond_id, attestations_bought, decline_reason, decision_log
    FROM broker_matches ORDER BY id DESC LIMIT 30`;
  res.json({ matches: rows });
});

app.get('/bonds', async (_req: Request, res: Response) => {
  const rows = await sql`
    SELECT id, job_id::text AS job_id, provider_id::text AS provider_id, status,
           bond_usdc, bond_id::text AS bond_id, requester_addr, created_at
    FROM broker_matches WHERE bond_id IS NOT NULL ORDER BY id DESC LIMIT 50`;
  res.json({ bonds: rows });
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', broker: config.brokerPrivateKey ? 'configured' : 'no-key', bond: config.brokerBondAddress ?? null });
});

export function startServer() {
  app.listen(config.port, () => console.log(`[broker] API listening on :${config.port}`));
}
