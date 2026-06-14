// Acceptance §4 — drive HireBot's Steward pay path for a specific rated agent.
//
// HireBot's normal loop only reaches the pay path when a FUNDED job has a RATED
// provider. At demo time the funded-job set may have only unrated providers (as
// happened on this run: 63 escrow+agent jobs, all providers unrated → would_skip).
// To demonstrate the dogfood loop deterministically we invoke the SAME pay path
// HireBot uses — `@caliber/steward-client.pay()` against the live Caliber attest
// URL, source='hirebot', expect {json:true} — for a known rated agent id.
//
// This is HONEST about being a forced trigger: it is byte-for-byte the call in
// services/hirebot/src/index.ts runOnce(), just with the provider id supplied on
// argv instead of scraped from a funded job.

import { db, hirebotDecisions, sql } from '@arc-agents/db';
import { createSteward, StewardRefusal } from '@caliber/steward-client';

const API_BASE = (process.env.CALIBER_API_BASE || 'https://caliber-api.poko.blue').replace(/\/+$/, '');
const STEWARD_BASE_URL = (process.env.STEWARD_BASE_URL || 'http://localhost:3300').replace(/\/+$/, '');
const PRICE = Number((process.env.X402_PRICE_USDC || '$0.001').replace(/[^0-9.]/g, '')) || 0.001;

function attestUrl(agentId: string): string {
  return `${API_BASE}/v1/agents/arc/${agentId}/attest`;
}

async function main(): Promise<void> {
  const providerId = process.argv[2];
  if (!providerId) throw new Error('usage: pay-provider.ts <agentId>');
  const apiKey = process.env.STEWARD_API_KEY;
  if (!apiKey) throw new Error('STEWARD_API_KEY not set');

  const steward = createSteward({ baseUrl: STEWARD_BASE_URL, apiKey, source: 'hirebot' });

  console.log(`[hirebot/forced] paying via Steward ${STEWARD_BASE_URL} for provider #${providerId}`);
  try {
    const res = await steward.pay(
      attestUrl(providerId),
      { method: 'POST', body: { minTier: 'Dormant', minConfidence: 'insufficient' } },
      { json: true },
    );
    const data = (res.data ?? {}) as { tier?: string; score?: number; flags?: string[] };
    const tier = data.tier ?? null;
    const score = (data.score ?? null) as number | null;
    await db.insert(hirebotDecisions).values({
      jobId: null,
      providerId: BigInt(providerId),
      action: 'purchased',
      rationale: `provider #${providerId}: Steward paid $${PRICE.toFixed(3)} for signed attestation → tier ${tier} score ${score} (forced trigger; no funded job in this cycle)`,
      costUsdc: PRICE.toFixed(6),
      budgetLeft: (10 - PRICE).toFixed(6),
      tier,
      score,
      paymentRef: res.txRef || null,
    });
    console.log(`[hirebot/forced] PURCHASED tier=${tier} score=${score} txRef=${res.txRef ?? '(none)'}`);
    if (res.conformance?.length) console.log('[hirebot/forced] conformance:', JSON.stringify(res.conformance));
  } catch (e) {
    if (e instanceof StewardRefusal) {
      await db.insert(hirebotDecisions).values({
        jobId: null,
        providerId: BigInt(providerId),
        action: 'would_skip',
        rationale: `provider #${providerId}: Steward ${e.decision} at stage '${e.stage}' — ${e.reasoning} (skipping this cycle)`,
        costUsdc: '0.000000',
        budgetLeft: '10.000000',
      });
      console.log(`[hirebot/forced] Steward ${e.decision.toUpperCase()} @ ${e.stage}: ${e.reasoning}`);
      console.log('[hirebot/forced] → logged to hirebot_decisions, worker did NOT crash (skip this cycle)');
    } else {
      throw e;
    }
  }
  await sql.end();
}

main().catch((e) => {
  console.error('[hirebot/forced] fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
