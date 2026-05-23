// POST /api/circle/uc/initialize
//
// Body: { userToken }
// Returns: { challengeId } on success.
//          Passes through Circle's 155106 (user already initialized) so the
//          client can skip wallet creation and load existing wallets instead.
//
// This is the missing step from our prior flow. After Google OAuth returns
// a userToken, the user is *authenticated* but doesn't have a wallet yet.
// /v1/w3s/user/initialize creates the wallet challenge. Frontend then runs
// sdk.execute(challengeId) to complete creation.
//
// Per Circle quickstart docs:
// https://developers.circle.com/wallets/user-controlled/create-user-wallets-with-social-login

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CIRCLE_BASE_URL = 'https://api.circle.com';

const bodySchema = z.object({ userToken: z.string().min(1) });

export async function POST(req: Request) {
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'not_configured', message: 'CIRCLE_API_KEY missing' },
      { status: 503 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  try {
    const r = await fetch(`${CIRCLE_BASE_URL}/v1/w3s/user/initialize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-User-Token': parsed.data.userToken,
      },
      body: JSON.stringify({
        idempotencyKey: randomUUID(),
        accountType: 'SCA',
        blockchains: ['ARC-TESTNET'],
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      // Pass Circle's error body through — particularly 155106 "user already
      // initialized" which the client treats as success.
      return NextResponse.json(data, { status: r.status });
    }
    return NextResponse.json(data.data ?? data, { status: 200 });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.json({ error: 'initialize_failed', message }, { status: 500 });
  }
}
