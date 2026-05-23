// POST /api/circle/faucet → request testnet USDC + native gas for the
// session's Circle demo wallet via Circle's faucet endpoint.

import { NextResponse } from 'next/server';
import { getOrCreateDemoSession } from '@/lib/circle/session';
import { getOrCreateWallet, requestFaucet } from '@/lib/circle/wallet-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const { sessionId } = await getOrCreateDemoSession();
    const wallet = await getOrCreateWallet(sessionId);
    await requestFaucet(wallet.address);
    return NextResponse.json({ ok: true, address: wallet.address });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: 'faucet_failed', message }, { status: 500 });
  }
}
