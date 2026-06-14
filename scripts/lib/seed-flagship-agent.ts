// scripts/lib/seed-flagship-agent.ts — seed a Caliber-rated seller for the flagship
// demo, mapped to the red-team seller address.
//
// The red-team seller address (REDTEAM_SELLER_ADDRESS) is NOT a real registered Arc
// agent. For the flagship to show a breach DROPPING a real Caliber rating, we seed
// a self-contained, clearly-synthetic agent whose owner_address == that seller:
//
//   • agents row     — registered ~40 days ago (clears the 14-day age gate), owner =
//                      the seller address, name tagged so it's obviously a fixture.
//   • jobs           — 4 Completed jobs from 4 DISTINCT clients (so completionRate=1,
//                      completedJobs≥2 for Silver/Gold, no CounterpartyConcentration).
//   • feedback_events — 30 positive (score 95) from distinct validators (so the
//                      network-endorsement feedback component is at its cap and a
//                      single breach observation visibly zeroes it; ≥5 validators so
//                      no ValidatorConcentration).
//
// Everything is scoped to a deterministic agentId (FLAGSHIP_AGENT_ID) so the demo is
// idempotent: re-seeding wipes the agent's prior feedback/jobs/snapshots/transitions
// and the steward breach feedback, then re-creates the clean baseline. Nothing real
// is touched — the agentId is far above any indexed Arc agent and the owner is the
// fixture seller.

import { sql } from '@arc-agents/db';

/** Deterministic synthetic agentId for the flagship demo seller. Far above any
 *  real indexed Arc agent so it never collides. */
export const FLAGSHIP_AGENT_ID = 999_000_001n;

const CHAIN = 'arc';
const POSITIVE_FEEDBACK = 30; // caps the feedback-volume sub-component (≥5 validators)
// Completed + disputed are tuned so the clean agent rates SILVER (sitting a few
// points above the Bronze floor): a single verified breach then zeroes the
// feedback-volume endorsement and drops it to BRONZE — a visible tier_down.
const COMPLETED_JOBS = 3;
const DISPUTED_JOBS = 2;

function addr(prefix: string, n: number): string {
  // Deterministic, clearly-synthetic 20-byte hex addresses.
  return `0x${prefix}${n.toString().padStart(40 - prefix.length, '0')}`.toLowerCase();
}

export interface SeedResult {
  agentId: bigint;
  sellerAddress: string;
  positiveFeedback: number;
  completedJobs: number;
}

/**
 * (Re)seed the flagship demo agent for `sellerAddress`. Idempotent: wipes the
 * agent's prior demo data first, then rebuilds the clean Silver/Gold baseline.
 */
export async function seedFlagshipAgent(sellerAddress: string): Promise<SeedResult> {
  const seller = sellerAddress.toLowerCase();
  const id = FLAGSHIP_AGENT_ID.toString();

  // ── wipe any prior state for this agent (idempotent re-runs) ──
  await sql`delete from tier_transitions where agent_id = ${id} and chain_id = ${CHAIN}`;
  await sql`delete from rating_snapshots where agent_id = ${id} and chain_id = ${CHAIN}`;
  await sql`delete from feedback_events where agent_id = ${id} and chain_id = ${CHAIN}`;
  // job_events FK-cascade off jobs; delete the demo jobs by their synthetic ids.
  await sql`delete from jobs where provider_address = ${seller} and chain_id = ${CHAIN} and job_id >= 999000000`;
  await sql`delete from agents where agent_id = ${id} and chain_id = ${CHAIN}`;
  // Also clear any steward_evidence from prior runs for this agent (no FK from
  // feedback_events; keep the table clean so the demo's "after" counts are honest).
  await sql`delete from steward_evidence where agent_id = ${id}`;

  // ── agents row (registered ~40 days ago so the 14-day age gate passes) ──
  const registeredAt = new Date(Date.now() - 40 * 86_400_000).toISOString();
  await sql`
    insert into agents (agent_id, chain_id, owner_address, name, agent_type,
                        feedback_count, jobs_completed, registered_at_block,
                        registered_tx_hash, registered_at, created_at, updated_at)
    values (${id}, ${CHAIN}, ${seller}, ${'Steward Flagship Demo Seller'}, ${'services'},
            ${POSITIVE_FEEDBACK}, ${COMPLETED_JOBS}, ${1},
            ${'0xflagshipseed'}, ${registeredAt}, now(), now())
  `;

  // ── Completed + disputed jobs from distinct clients (≥3 → no counterparty flag) ──
  const totalJobs = COMPLETED_JOBS + DISPUTED_JOBS;
  for (let i = 0; i < totalJobs; i++) {
    const jobId = (999_000_000 + i).toString();
    const client = addr('c1ad', i + 1);
    const completed = i < COMPLETED_JOBS;
    const createdAt = new Date(Date.now() - (20 - i) * 86_400_000).toISOString(); // within the 30d lookback
    const updatedAt = new Date(Date.now() - (20 - i) * 86_400_000 + 2 * 3_600_000).toISOString(); // 2h latency, consistent
    await sql`
      insert into jobs (job_id, chain_id, client_address, provider_address, budget_usdc,
                        status, completion_reason, created_at_block, created_tx_hash,
                        completed_at_block, completed_tx_hash, created_at, updated_at)
      values (${jobId}, ${CHAIN}, ${client}, ${seller}, ${'1.000000'},
              ${completed ? 'Completed' : 'Rejected'}, ${completed ? 'delivered' : 'rejected'},
              ${100 + i}, ${`0xseedjob${i}`},
              ${completed ? 200 + i : null}, ${completed ? `0xseedjobc${i}` : null},
              ${createdAt}, ${updatedAt})
    `;
  }

  // ── 30 positive feedback (score 95) from distinct validators (≥5 → no flag) ──
  for (let i = 0; i < POSITIVE_FEEDBACK; i++) {
    const validator = addr('11d8', i + 1);
    const createdAt = new Date(Date.now() - (25 - (i % 20)) * 86_400_000).toISOString();
    await sql`
      insert into feedback_events (chain_id, agent_id, validator_address, score, score_type,
                                   tag, feedback_hash, block_number, tx_hash, log_index, created_at)
      values (${CHAIN}, ${id}, ${validator}, ${'95'}, ${0},
              ${'successful_trade'}, ${`0xseedfb${i}`}, ${1000 + i}, ${`0xseedfbtx${i}`}, ${i}, ${createdAt})
    `;
  }

  // Recompute aggregate columns consistently (the rating engine reads the rows, but
  // other surfaces read these aggregates).
  await sql`
    update agents set
      feedback_count = (select count(*) from feedback_events fe where fe.agent_id = ${id} and fe.chain_id = ${CHAIN}),
      reputation_score = (select avg(fe.score) from feedback_events fe where fe.agent_id = ${id} and fe.chain_id = ${CHAIN}),
      updated_at = now()
    where agent_id = ${id} and chain_id = ${CHAIN}
  `;

  return {
    agentId: FLAGSHIP_AGENT_ID,
    sellerAddress: seller,
    positiveFeedback: POSITIVE_FEEDBACK,
    completedJobs: COMPLETED_JOBS,
  };
}
