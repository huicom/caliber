import 'dotenv/config';
import express from 'express';
// Wave 0 (2026-05-21): handlers consolidated from rating/api/v1/* into
// rating/src/* — one source directory for everything the Express app needs.
import { ratingRoute } from './rating';
import { attestRoute } from './attest';
import { bulkRatingsRoute } from './bulk';
import { distributionRoute } from './distribution';
import { ratingHistoryRoute } from './history';
import { distributionHistoryRoute } from './distribution-history';
import { exposureSummaryRoute } from './exposure-summary';
import { transitionAttestRoute } from './transitions';

// Defensive x402 import: if the @circle-fin/x402-batching SDK or its peer
// deps are missing (e.g. pnpm install wasn't re-run after a pull), load the
// middleware lazily so the rest of the rating API stays up. Better to serve
// 503 on the attest endpoint than crash-loop the whole service.
type Middleware = (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => void | Promise<void>;
let x402Middleware: Middleware;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  x402Middleware = (require('./x402') as { x402Middleware: Middleware }).x402Middleware;
  console.log('[server] x402 middleware loaded · Circle Gateway available');
} catch (err) {
  const msg = err instanceof Error ? err.message : 'unknown';
  console.warn(`[server] x402 middleware FAILED to load: ${msg}`);
  console.warn(`[server] /v1/agents/:chain/:id/attest will return 503 until fixed.`);
  console.warn(`[server] Likely cause: missing dep. Run \`pnpm install\` and restart.`);
  x402Middleware = (_req, res, _next) => {
    res.status(503).json({
      error: 'x402_unavailable',
      message:
        'x402 middleware failed to initialise on server boot — see arc-rating logs. Other rating endpoints still work.',
    });
  };
}

const app = express();

// CORS for browser callers (web app, third-party explorers, etc.)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-PAYMENT, x-payment-proof, x-x402-bypass',
  );
  res.setHeader(
    'Access-Control-Expose-Headers',
    'X-PAYMENT-RESPONSE, payment-required, x-payment-accepted',
  );
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.json({ limit: '64kb' }));

app.get('/v1/agents/:chain/:id/rating', ratingRoute);
app.get('/v1/agents/:chain/:id/rating/history', ratingHistoryRoute);
app.post('/v1/agents/:chain/:id/attest', x402Middleware, attestRoute);
app.get('/v1/ratings/bulk', bulkRatingsRoute);
app.post('/v1/ratings/bulk', bulkRatingsRoute);
app.get('/v1/ratings/distribution', distributionRoute);
app.get('/v1/ratings/distribution/history', distributionHistoryRoute);
app.get('/v1/ratings/exposure-summary', exposureSummaryRoute);
app.post('/v1/transitions/:id/attest', transitionAttestRoute);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Default 3100 — port 3000 is web, 3001 historically used by stale next dev sessions.
const port = process.env.PORT || 3100;
app.listen(port, () => {
  console.log(`Rating API server listening on :${port}`);
});
