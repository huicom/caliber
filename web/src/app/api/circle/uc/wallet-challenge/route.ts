// POST /api/circle/uc/wallet-challenge
//
// Body: { userToken }
// Returns: { challengeId }
//
// Frontend runs the challenge via sdk.execute(challengeId). User goes
// through PIN setup (if first time) + wallet creation. Wallet appears
// shortly after the SDK reports success.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createWalletWithPinChallenge } from '@/lib/circle/user-controlled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ userToken: z.string().min(1) });

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  try {
    const { challengeId } = await createWalletWithPinChallenge(parsed.data.userToken);
    return NextResponse.json({ challengeId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: 'challenge_failed', message }, { status: 500 });
  }
}
