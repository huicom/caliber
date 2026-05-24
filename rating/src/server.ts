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
import { x402Middleware } from './x402';

const app = express();

// CORS for browser callers (web app, third-party explorers, etc.)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-payment-proof');
  res.setHeader('Access-Control-Expose-Headers', 'x-payment-accepted');
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
