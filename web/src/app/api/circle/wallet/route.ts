// GET  /api/circle/wallet → returns the session's Circle demo wallet
//                          (creates one if missing). Returns 503 when
//                          Circle env vars are not configured.
// POST /api/circle/wallet → same as GET; semantic-only distinction.

import { NextResponse } from 'next/server';
import { getOrCreateDemoSession } from '@/lib/circle/session';
import { getOrCreateWallet } from '@/lib/circle/wallet-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle() {
  try {
    const { sessionId } = await getOrCreateDemoSession();
    const wallet = await getOrCreateWallet(sessionId);
    return NextResponse.json({ wallet, sessionId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    // Surface env-not-configured as a 503 so the UI can show a "demo mode
    // unavailable" message instead of a generic 500.
    const status =
      message.includes('CIRCLE_API_KEY') || message.includes('CIRCLE_DEMO_WALLET_SET_ID')
        ? 503
        : 500;
    return NextResponse.json({ error: 'circle_demo_failed', message }, { status });
  }
}

export async function GET() {
  return handle();
}

export async function POST() {
  return handle();
}
