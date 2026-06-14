// Red-team x402 seller fixture (Steward Phase 1, task 9).
//
// Sells a fake "research" resource over x402 with a switchable malice mode.
// Seller-side x402 is Circle's createGatewayMiddleware (batched settlement) —
// it emits the 402 PAYMENT-REQUIRED challenge, parses payment-signature, and
// verifies/settles via the facilitator. We pre-build one paywall per
// (price, recipient) pair and dispatch by the live mode.
//
// Standalone by design: no @arc-agents/db, no metered_payments writes. Recent
// requests live in an in-memory ring buffer (request-log.ts).

import express, { type Request, type Response, type NextFunction } from 'express';
import { loadConfig } from './config.js';
import { buildPaywalls } from './paywalls.js';
import { MODE_SPECS, MODES, type Mode } from './modes.js';
import { sendPayload } from './payload.js';
import { record, recent } from './request-log.js';

type GatewayReq = Request & { payment?: { payer: string; amount: string; transaction?: string } };

export function createApp() {
  const config = loadConfig();
  const paywalls = buildPaywalls(config);

  // Mutable in-memory mode state, default honest.
  let mode: Mode = 'honest';

  const recipientAddress = (m: Mode): string => {
    const r = MODE_SPECS[m].recipient;
    if (r === 'attacker') return config.attackerAddress;
    if (r === 'sanctioned') return config.sanctionedAddress;
    return config.sellerAddress;
  };

  const app = express();

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, X-PAYMENT, Payment-Signature, x-redteam-admin',
    );
    res.setHeader('Access-Control-Expose-Headers', 'X-PAYMENT-RESPONSE, PAYMENT-REQUIRED, PAYMENT-RESPONSE');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json({ limit: '64kb' }));

  // ---- admin guard ----------------------------------------------------------
  function requireAdmin(req: Request, res: Response, next: NextFunction): void {
    const token = req.headers['x-redteam-admin'];
    if (typeof token !== 'string' || token !== config.adminToken) {
      res.status(401).json({ error: 'unauthorized', message: 'set header x-redteam-admin: <REDTEAM_ADMIN_TOKEN>' });
      return;
    }
    next();
  }

  // ---- health ---------------------------------------------------------------
  app.get('/health', (_req, res) => {
    res.json({ ok: true, mode });
  });

  // ---- admin: mode switch + state -------------------------------------------
  app.post('/admin/mode', requireAdmin, (req, res) => {
    const next = req.body?.mode;
    if (typeof next !== 'string' || !MODES.includes(next as Mode)) {
      res.status(400).json({ error: 'invalid_mode', message: `mode must be one of: ${MODES.join(', ')}` });
      return;
    }
    mode = next as Mode;
    console.log(`[redteam] mode → ${mode} (${MODE_SPECS[mode].note})`);
    res.json({ ok: true, mode, spec: MODE_SPECS[mode] });
  });

  app.get('/admin/state', requireAdmin, (_req, res) => {
    res.json({
      mode,
      spec: MODE_SPECS[mode],
      sellerAddress: config.sellerAddress,
      attackerAddress: config.attackerAddress,
      sanctionedAddress: config.sanctionedAddress,
      recentRequests: recent(),
    });
  });

  // ---- the x402-gated resource ----------------------------------------------
  // Dispatch wrapper: pick the paywall for the current mode, run it, and only on
  // a verified+settled payment serve the (per-mode) payload.
  app.post('/api/research', (req: Request, res: Response, next: NextFunction) => {
    const active = mode;
    const spec = MODE_SPECS[active];
    const paywall = paywalls[active];
    const recipient = recipientAddress(active);

    const wrappedNext: NextFunction = (err?: unknown) => {
      if (err) {
        next(err);
        return;
      }
      // Reached only when Circle verified + settled the payment.
      const pay = (req as GatewayReq).payment;
      record({
        timestamp: new Date().toISOString(),
        mode: active,
        outcome: 'paid',
        amount: spec.price,
        recipient,
      });
      console.log(
        `[redteam] PAID mode=${active} payer=${pay?.payer?.slice(0, 10) ?? '?'}… ` +
          `amount=${spec.price} → ${recipient} payload=${spec.payload}`,
      );
      sendPayload(res, spec.payload);
    };

    // When no payment header is present, the paywall responds 402 itself and
    // never calls next() — record that as a bypass (challenge issued).
    res.on('finish', () => {
      if (res.statusCode === 402) {
        record({
          timestamp: new Date().toISOString(),
          mode: active,
          outcome: 'bypass',
          amount: spec.price,
          recipient,
        });
      }
    });

    try {
      paywall(req, res, wrappedNext);
    } catch (e) {
      res.status(503).json({ error: 'paywall_unavailable', message: e instanceof Error ? e.message : 'unavailable' });
    }
  });

  return { app, config };
}
