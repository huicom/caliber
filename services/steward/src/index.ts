// Steward service entry point. Boots the Express app on STEWARD_PORT.

import { createApp } from './server.js';
import { seedDefaultMandateIfEmpty } from './policy-store.js';
import { treasurerEnabled, llmFallback } from './llm-config.js';
import { startTelegramBot } from './telegram.js';

const { app, config, pipeline } = createApp();

// Seed the default mandate (if the table is empty) before accepting traffic, so
// the very first payment is governed by a real, human-readable policy.
seedDefaultMandateIfEmpty().catch((err) => {
  console.error('[steward] mandate seed failed (continuing with env fallback):', err);
});

app.listen(config.port, () => {
  console.log(`[steward] CFO payment proxy listening on :${config.port}`);
  console.log(`[steward]   per-tx cap (env fallback) = ${config.maxTxUsdc} USDC`);
  console.log(
    `[steward]   LLM treasurer = ${treasurerEnabled() ? `ENABLED (fallback=${llmFallback()})` : 'disabled (pure deterministic)'}`,
  );
  console.log('[steward]   POST /v1/pay                  (header x-steward-key)');
  console.log('[steward]   POST /v1/mandate              (header x-steward-key)');
  console.log('[steward]   GET  /v1/policy               (header x-steward-key)');
  console.log('[steward]   GET  /v1/approvals            (header x-steward-key)');
  console.log('[steward]   POST /v1/approvals/:id/decide (header x-steward-key)');

  // Start the Telegram interrupt bot alongside the HTTP service. A bot failure
  // must NEVER crash the payment service — guard it.
  try {
    startTelegramBot(pipeline);
  } catch (err) {
    console.error('[steward] telegram bot failed to start (continuing without it):', err);
  }
});
