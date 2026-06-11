import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

// Lepton Phase 3 (C1): the single source for traction-form answers. Every
// number is computed from chain/DB state, split by payer class so external use
// is never conflated with our own demo traffic (Guardrail 4). No fabricated
// values — empty state returns zeros.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  if (process.env.NEXT_PUBLIC_LEPTON !== '1') {
    return NextResponse.json({ error: 'not_enabled' }, { status: 404 });
  }

  const [metered] = await sql<{
    paid_requests: number; usdc_earned: number; unique_payers: number;
    external_requests: number; demo_requests: number;
    external_usdc: number; demo_usdc: number; avg_tx_usdc: number; broker_fee_requests: number;
  }[]>`
    SELECT
      count(*) FILTER (WHERE amount_usdc > 0)::int AS paid_requests,
      COALESCE(SUM(amount_usdc) FILTER (WHERE payer_class <> 'internal'), 0)::float8 AS usdc_earned,
      count(DISTINCT payer_address) FILTER (WHERE amount_usdc > 0)::int AS unique_payers,
      count(*) FILTER (WHERE amount_usdc > 0 AND payer_class = 'external')::int AS external_requests,
      count(*) FILTER (WHERE amount_usdc > 0 AND payer_class = 'demo')::int AS demo_requests,
      COALESCE(SUM(amount_usdc) FILTER (WHERE payer_class = 'external'), 0)::float8 AS external_usdc,
      COALESCE(SUM(amount_usdc) FILTER (WHERE payer_class = 'demo'), 0)::float8 AS demo_usdc,
      COALESCE(AVG(amount_usdc) FILTER (WHERE amount_usdc > 0), 0)::float8 AS avg_tx_usdc,
      count(*) FILTER (WHERE endpoint = 'broker_fee' AND amount_usdc > 0)::int AS broker_fee_requests
    FROM metered_payments`;

  const [hb] = await sql<{
    decisions: number; purchased: number; cache_hit: number; would_hire: number;
    spend: number; budget_left: number;
  }[]>`
    SELECT
      count(*)::int AS decisions,
      count(*) FILTER (WHERE action = 'purchased')::int AS purchased,
      count(*) FILTER (WHERE action = 'cache_hit')::int AS cache_hit,
      count(*) FILTER (WHERE action = 'would_hire')::int AS would_hire,
      COALESCE(SUM(cost_usdc), 0)::float8 AS spend,
      COALESCE((SELECT budget_left FROM hirebot_decisions ORDER BY id DESC LIMIT 1), 0)::float8 AS budget_left
    FROM hirebot_decisions`;

  const [bk] = await sql<{
    matches: number; declined: number; bonded: number; released: number; slashed: number; bonded_usdc: number;
  }[]>`
    SELECT
      count(*)::int AS matches,
      count(*) FILTER (WHERE status = 'declined')::int AS declined,
      count(*) FILTER (WHERE bond_id IS NOT NULL)::int AS bonded,
      count(*) FILTER (WHERE status = 'released')::int AS released,
      count(*) FILTER (WHERE status = 'slashed')::int AS slashed,
      COALESCE(SUM(bond_usdc) FILTER (WHERE bond_id IS NOT NULL), 0)::float8 AS bonded_usdc
    FROM broker_matches`;

  // Payment-chain depth: how many distinct hops of the chain we have evidence
  // for — requester→broker fee, broker→Caliber attestation, bond escrow, settle.
  const lookups = (hb?.purchased ?? 0) + (hb?.cache_hit ?? 0);
  const hops = {
    requester_to_broker_fee: (metered?.broker_fee_requests ?? 0) > 0,
    broker_to_caliber_attestation: (metered?.paid_requests ?? 0) > 0,
    bond_escrow: (bk?.bonded ?? 0) > 0,
    settlement: (bk?.released ?? 0) + (bk?.slashed ?? 0) > 0,
  };
  const depthAchieved = Object.values(hops).filter(Boolean).length;

  return NextResponse.json({
    chain: 'arc-testnet',
    generated_at: new Date().toISOString(),
    honest_traction_note:
      'All metered rows are classified external | demo | internal. Only `external` counts as genuine outside use. Bypass/internal rows are amount-0 and never counted as revenue.',
    metered: {
      paid_requests: metered?.paid_requests ?? 0,
      usdc_earned: round(metered?.usdc_earned),
      unique_payers: metered?.unique_payers ?? 0,
      avg_tx_usdc: round(metered?.avg_tx_usdc, 6),
      external: { requests: metered?.external_requests ?? 0, usdc: round(metered?.external_usdc) },
      demo: { requests: metered?.demo_requests ?? 0, usdc: round(metered?.demo_usdc) },
    },
    payment_chain: { depth_achieved: depthAchieved, of: 4, hops },
    bonds: {
      posted: bk?.bonded ?? 0,
      released: bk?.released ?? 0,
      slashed: bk?.slashed ?? 0,
      total_bonded_usdc: round(bk?.bonded_usdc),
      matches_total: bk?.matches ?? 0,
      matches_declined: bk?.declined ?? 0,
    },
    hirebot: {
      decisions: hb?.decisions ?? 0,
      attestations_bought: hb?.purchased ?? 0,
      cache_hits: hb?.cache_hit ?? 0,
      cache_hit_rate: lookups > 0 ? round((hb?.cache_hit ?? 0) / lookups, 4) : 0,
      would_hire: hb?.would_hire ?? 0,
      spend_usdc: round(hb?.spend, 6),
      budget_left_usdc: round(hb?.budget_left, 6),
      decisions_per_usdc: (hb?.spend ?? 0) > 0 ? round((hb?.decisions ?? 0) / (hb?.spend ?? 1), 1) : null,
    },
  });
}

function round(n: number | undefined, dp = 3): number {
  const v = n ?? 0;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
