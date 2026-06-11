// Keeper (Lepton Phase 2, B2.7). Watches bonded matches and settles them once
// the underlying ERC-8183 job is terminal. The indexer emits completed/rejected
// but does NOT index Expired, so the keeper reads job state on-chain directly.
// release()/slash() are permissionless anyway — this just automates them.

import { sql } from '@arc-agents/db';
import { config } from './config.js';
import { getJobStatus, releaseOnChain, slashOnChain } from './chain.js';

interface BondedRow {
  id: string;
  job_id: string;
  bond_id: string;
}

async function appendStep(matchId: string, status: string, step: { step: string; detail: string; ref?: string }): Promise<void> {
  await sql`
    UPDATE broker_matches
    SET status = ${status}, decision_log = decision_log || ${JSON.stringify([step])}::jsonb
    WHERE id = ${matchId}`;
}

export async function settleActiveBonds(): Promise<number> {
  if (!config.brokerBondAddress) return 0;
  const rows = await sql<BondedRow[]>`
    SELECT id, job_id::text AS job_id, bond_id::text AS bond_id
    FROM broker_matches
    WHERE status = 'bonded' AND bond_id IS NOT NULL AND job_id IS NOT NULL`;

  let settled = 0;
  for (const r of rows) {
    let jobStatus: string;
    try {
      jobStatus = await getJobStatus(BigInt(r.job_id));
    } catch (e) {
      console.warn(`[keeper] job ${r.job_id} status read failed:`, e instanceof Error ? e.message : e);
      continue;
    }
    try {
      if (jobStatus === 'Completed') {
        const tx = await releaseOnChain(BigInt(r.bond_id));
        await appendStep(r.id, 'released', { step: 'release', detail: `job completed → bond ${r.bond_id} released to broker`, ref: tx });
        settled += 1;
        console.log(`[keeper] released bond ${r.bond_id} (job ${r.job_id})`);
      } else if (jobStatus === 'Rejected' || jobStatus === 'Expired') {
        const tx = await slashOnChain(BigInt(r.bond_id));
        await appendStep(r.id, 'slashed', { step: 'slash', detail: `job ${jobStatus.toLowerCase()} → bond ${r.bond_id} slashed to requester`, ref: tx });
        settled += 1;
        console.log(`[keeper] slashed bond ${r.bond_id} (job ${r.job_id}, ${jobStatus})`);
      }
    } catch (e) {
      console.error(`[keeper] settle failed for bond ${r.bond_id}:`, e instanceof Error ? e.message : e);
    }
  }
  return settled;
}

// Standalone entry: one settle pass (the broker server also runs this on a loop).
if (process.argv[1] && process.argv[1].endsWith('keeper.ts')) {
  settleActiveBonds()
    .then((n) => { console.log(`[keeper] settled ${n} bond(s)`); return sql.end(); })
    .catch((e) => { console.error('[keeper] fatal:', e); process.exit(1); });
}
