// Steward quickstart — one authorized payment against the live API.
//
// Run it:
//   STEWARD_API_KEY=<your-demo-key> \
//   SELLER_URL=https://your-seller.example.com/api/research \
//   node quickstart.mjs
//
// With a real package install this import is just:
//   import { createSteward, StewardRefusal } from '@caliber/steward-client';
// In this in-repo example we import the built dist directly so it runs without
// publishing first.
import { createSteward, StewardRefusal } from '../dist/index.js';

const baseUrl = process.env.STEWARD_BASE_URL ?? 'https://steward-api.poko.blue';
const apiKey = process.env.STEWARD_API_KEY ?? 'demo-key-request-from-caliber-team';
const sellerUrl = process.env.SELLER_URL ?? 'https://seller.example.com/api/research';

const steward = createSteward({ baseUrl, apiKey, source: 'quickstart' });

console.log(`[steward] paying ${sellerUrl} via ${baseUrl} ...`);

try {
  const res = await steward.pay(sellerUrl, {
    method: 'POST',
    body: { query: 'summarize the latest Arc testnet stats' },
  });

  console.log('[steward] ALLOWED — payment settled.');
  console.log('  requestId:', res.requestId);
  if (res.quote) console.log(`  paid ${res.quote.amountUsdc} USDC → ${res.quote.payTo}`);
  if (res.txRef) console.log('  settlement ref:', res.txRef);
  console.log('  goods (seller response):', JSON.stringify(res.data)?.slice(0, 400));
  if (res.conformance?.length) console.log('  conformance violations:', res.conformance);
} catch (err) {
  if (err instanceof StewardRefusal) {
    // Steward refused before (or instead of) settling — nothing was paid.
    console.warn(`[steward] REFUSED (${err.decision}) at stage "${err.stage}": ${err.reasoning}`);
    console.warn(`  httpStatus=${err.httpStatus} requestId=${err.requestId ?? '(none)'}`);
    process.exitCode = 0; // a refusal is a valid, expected outcome
  } else {
    // Transport / auth (401) / bad-request (400) — not a payment decision.
    console.error('[steward] ERROR:', err.message);
    process.exitCode = 1;
  }
}
