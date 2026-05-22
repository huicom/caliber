// POST /api/v1/route — one-call agent recommendation with signed attestation.
//
// Phase B / Track 5. The AI-native primitive: a smart contract or agent
// orchestrator describes what it needs in natural language and gets back
//   { agent_id, address, attestation_signed }
// where the attestation is EIP-712 signed by Caliber and verifiable by any
// caller against the on-chain RatingVerifier at
// 0xE3b1e82f1A047BC5B41d8982EaC635EC61526EE8.
//
// Request:
//   {
//     "intent":           "trading bot for prediction markets",   required
//     "min_tier":         "Proven",                              default "Provisional"
//     "category":         "trading",                             optional
//     "blocking_flags":   0,                                     optional bitmask
//     "chain":            "arc"                                  default
//   }
//
// Response 200 OK:
//   {
//     match:        { agent_id, name, owner_address, tier, similarity, match_reason },
//     attestation:  { ... },              // EIP-712 envelope
//     signature:    "0x..."               // sig over typed-data hash
//     validUntil:   <unix>                // when the attestation expires
//     methodologyVersion: "2.0.0"
//   }
//
// 404 if no agent matches; 422 if best candidate fails the min_tier gate;
// 502 if the upstream attest endpoint can't sign (e.g. agent has no
// verifiable owner address).

import { z } from 'zod';
import { db } from '@/lib/db';
import { sql as drizzleSql } from 'drizzle-orm';
import { embedText, toVectorLiteral } from '@/lib/embeddings/embed';
import { categoryBySlug } from '@/lib/categories';
import { ok, badRequest, notFound, serverError } from '@/lib/api-helpers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const TIER_ORDINAL: Record<string, number> = {
  Established: 0,
  Proven: 1,
  Emerging: 2,
  Provisional: 3,
  Watch: 4,
  Inactive: 5,
};

const requestSchema = z.object({
  intent: z.string().min(3).max(500),
  min_tier: z.enum(['Established', 'Proven', 'Emerging', 'Provisional']).optional().default('Provisional'),
  category: z.string().optional(),
  blocking_flags: z.number().int().min(0).max(0x1f).optional().default(0),
  chain: z.string().optional().default('arc'),
});

const RATING_API_BASE =
  process.env.NEXT_PUBLIC_RATING_API_BASE ?? 'https://caliber-api.poko.blue';

interface CandidateRow {
  agent_id: string;
  name: string;
  category: string | null;
  jobs_completed: number;
  description: string | null;
  similarity: number;
  tier: string | null;
  owner_address: string;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('body must be JSON');
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest('bad input', parsed.error.message);
  }
  const { intent, min_tier, category, chain } = parsed.data;

  if (category && !categoryBySlug(category)) {
    return badRequest(`unknown category: ${category}`);
  }

  try {
    const embedding = await embedText(intent);
    const vec = toVectorLiteral(embedding);
    const minOrd = TIER_ORDINAL[min_tier];
    const categoryClause = category ? `AND a.category = '${category.replace(/'/g, "''")}'` : '';

    // Cosine-rank candidates, filter by min_tier ordinal.
    // We pull top 25 then take the first one that has a valid owner_address;
    // the attest endpoint refuses agents with 0x000…000 owner.
    const r: any = await db.execute(drizzleSql.raw(`
      SELECT
        a.agent_id::text AS agent_id,
        a.name,
        a.category,
        a.jobs_completed,
        LEFT(a.metadata->>'description', 200) AS description,
        1 - (a.embedding <=> '${vec}'::vector) AS similarity,
        s.tier,
        a.owner_address
      FROM agents a
      LEFT JOIN LATERAL (
        SELECT tier FROM rating_snapshots WHERE agent_id = a.agent_id AND view = 'PIT'
        ORDER BY computed_at DESC LIMIT 1
      ) s ON true
      WHERE a.embedding IS NOT NULL
        AND a.name IS NOT NULL
        AND s.tier IS NOT NULL
        ${categoryClause}
      ORDER BY a.embedding <=> '${vec}'::vector ASC
      LIMIT 25;
    `));
    const candidates = (r.rows ?? r) as CandidateRow[];

    // First viable: meets tier AND has a real owner address
    let chosen: CandidateRow | null = null;
    for (const c of candidates) {
      const ord = TIER_ORDINAL[c.tier ?? 'Inactive'] ?? 9;
      if (ord <= minOrd && c.owner_address && c.owner_address !== '0x0000000000000000000000000000000000000000') {
        chosen = c;
        break;
      }
    }
    if (!chosen) {
      // Distinguish "no candidates at all" vs "candidates exist but fail the gate"
      if (candidates.length === 0) {
        return notFound('no agents match this intent');
      }
      const topTier = candidates[0]?.tier ?? 'Inactive';
      return NextResponse.json(
        {
          error: 'no_qualified_match',
          detail: `best candidate is tier=${topTier}, requested min_tier=${min_tier}`,
          best_unqualified: {
            agent_id: candidates[0].agent_id,
            name: candidates[0].name,
            tier: topTier,
            similarity: Number(candidates[0].similarity?.toFixed(3) ?? 0),
          },
        },
        { status: 422 },
      );
    }

    // Forward to the rating service to sign the attestation.
    const attestRes = await fetch(
      `${RATING_API_BASE}/v1/agents/${chain}/${chosen.agent_id}/attest`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ minTier: min_tier }),
        cache: 'no-store',
      },
    );
    if (!attestRes.ok) {
      const detail = await attestRes.text().catch(() => '');
      return NextResponse.json(
        {
          error: 'upstream_attest_failed',
          status: attestRes.status,
          detail: detail.slice(0, 400),
        },
        { status: 502 },
      );
    }
    const envelope = await attestRes.json();

    return ok({
      chain,
      match: {
        agent_id: chosen.agent_id,
        name: chosen.name,
        owner_address: chosen.owner_address,
        tier: chosen.tier,
        category: chosen.category,
        similarity: Number(chosen.similarity?.toFixed(3) ?? 0),
        match_reason: `semantic match on "${intent.slice(0, 80)}${intent.length > 80 ? '…' : ''}"; cosine similarity ${chosen.similarity?.toFixed(3)}`,
        passport_url: `/passport/${chain}/${chosen.agent_id}`,
      },
      attestation: envelope.attestation,
      signature: envelope.signature,
      valid_until: envelope.validUntil,
      methodology_version: envelope.methodologyVersion,
    });
  } catch (err) {
    return serverError('route failed', err);
  }
}

// CORS preflight — let smart-contract relayers / SDKs in browsers call this.
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    },
  });
}
