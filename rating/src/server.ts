import 'dotenv/config';
import express from 'express';
// Wave 0 (2026-05-21): handlers consolidated from rating/api/v1/* into
// rating/src/* — one source directory for everything the Express app needs.
import { ratingRoute } from './rating';
import { attestRoute } from './attest';
import { bulkRatingsRoute } from './bulk';
import { distributionRoute } from './distribution';

const app = express();

// CORS for browser callers (web app, third-party explorers, etc.)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.json({ limit: '64kb' }));

app.get('/v1/agents/:chain/:id/rating', ratingRoute);
app.post('/v1/agents/:chain/:id/attest', attestRoute);
app.get('/v1/ratings/bulk', bulkRatingsRoute);
app.post('/v1/ratings/bulk', bulkRatingsRoute);
app.get('/v1/ratings/distribution', distributionRoute);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Default 3100 — port 3000 is web, 3001 historically used by stale next dev sessions.
const port = process.env.PORT || 3100;
app.listen(port, () => {
  console.log(`Rating API server listening on :${port}`);
});
