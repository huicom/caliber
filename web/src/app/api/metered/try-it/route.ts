import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { CaliberPayer } from '@caliber/x402-client';

// Lepton Phase 1 (A3.3): the judge "Try it" button. Runs ONE real x402 paid
// request from a server-held, faucet-funded demo wallet through the genuine
// paid path (NOT the bypass header) and returns the signed attestation + the
// settlement reference. This is the moment a judge personally fires a sub-cent
// nanopayment, so it is rate-limited and capped, with clear error states.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_BASE = (process.env.CALIBER_API_BASE || 'https://caliber-api.poko.blue').replace(/\/+$/, '');
const DAILY_CAP = Number(process.env.TRYIT_DAILY_CAP ?? 200);

// In-memory guards (single web instance). Good enough for a demo surface.
const lastByIp = new Map<string, number>();
let day = '';
let dayCount = 0;

function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  return (xff?.split(',')[0] || req.headers.get('x-real-ip') || 'local').trim();
}

function resolveKey(): `0x${string}` | null {
  const k = process.env.TRYIT_PRIVATE_KEY || process.env.TEST_FUNDER_PRIVATE_KEY;
  if (!k) return null;
  return (k.startsWith('0x') ? k : `0x${k}`) as `0x${string}`;
}

export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_LEPTON !== '1') {
    return NextResponse.json({ error: 'not_enabled' }, { status: 404 });
  }

  // Rate limit: 1 per IP per minute.
  const ip = clientIp(req);
  const now = Date.now();
  const prev = lastByIp.get(ip) ?? 0;
  if (now - prev < 60_000) {
    return NextResponse.json(
      { error: 'rate_limited', message: 'One try-it per minute. Give it a few seconds.' },
      { status: 429 },
    );
  }

  // Daily cap (UTC).
  const today = new Date(now).toISOString().slice(0, 10);
  if (today !== day) { day = today; dayCount = 0; }
  if (dayCount >= DAILY_CAP) {
    return NextResponse.json(
      { error: 'daily_cap', message: `Daily try-it cap (${DAILY_CAP}) reached. Resets at 00:00 UTC.` },
      { status: 429 },
    );
  }

  const key = resolveKey();
  if (!key) {
    return NextResponse.json(
      { error: 'not_configured', message: 'No demo wallet key configured (TRYIT_PRIVATE_KEY).' },
      { status: 503 },
    );
  }

  // Pick a random recently-rated agent so each click shows a real attestation.
  let agentId: string;
  try {
    const rows = await sql<{ agent_id: string }[]>`
      SELECT agent_id::text AS agent_id
      FROM rating_snapshots
      WHERE computed_at = (SELECT max(computed_at) FROM rating_snapshots)
        AND tier IN ('Gold', 'Silver', 'Bronze')
        AND confidence IN ('high', 'moderate')
      ORDER BY random() LIMIT 1`;
    if (!rows[0]) {
      return NextResponse.json({ error: 'no_rated_agents', message: 'No rated agents available right now.' }, { status: 503 });
    }
    agentId = rows[0].agent_id;
  } catch (e) {
    return NextResponse.json({ error: 'db_error', message: e instanceof Error ? e.message : 'db' }, { status: 500 });
  }

  // Reserve the slot before paying so a slow facilitator can't be hammered.
  lastByIp.set(ip, now);
  dayCount += 1;

  try {
    const payer = new CaliberPayer({ privateKey: key, apiBase: API_BASE });
    const res = await payer.payForAttestation(agentId);
    if (res.status < 200 || res.status >= 300) {
      return NextResponse.json(
        { error: 'unrated', agentId, message: res.data.detail ?? res.data.reason ?? 'agent unrated' },
        { status: 200 },
      );
    }
    return NextResponse.json({
      ok: true,
      agentId,
      tier: res.data.tier,
      score: res.data.score,
      confidence: res.data.confidence,
      flags: res.data.flags ?? [],
      methodologyVersion: res.data.methodologyVersion,
      amountUsdc: res.payment.amountUsdc,
      paymentRef: res.payment.transaction,
      passportUrl: `/passport/arc/${agentId}`,
    });
  } catch (e) {
    // Roll back the daily counter on a hard failure (no value delivered).
    dayCount = Math.max(0, dayCount - 1);
    return NextResponse.json(
      { error: 'payment_failed', message: e instanceof Error ? e.message : 'payment failed' },
      { status: 502 },
    );
  }
}
