// GET /api/circle/transaction/[id] → poll transaction status.

import { NextResponse } from 'next/server';
import { getTransactionStatus } from '@/lib/circle/wallet-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const status = await getTransactionStatus(id);
    return NextResponse.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: 'tx_lookup_failed', message }, { status: 500 });
  }
}
