// POST /api/circle/uc/session
//
// Two modes:
//   (a) PIN mode (default, no body):  cookie-derived Caliber user. Server
//       calls createUser + createUserToken and returns userToken/encryptionKey.
//   (b) Google mode (body: { userToken }): the frontend already has a
//       Google-issued userToken from performLogin('Google'). Server just
//       queries wallet info; the userToken is passed back through unchanged.
//
// Both modes return the same shape so the UI can treat them uniformly.

import { NextResponse } from 'next/server';
import { getOrCreateDemoSession } from '@/lib/circle/session';
import {
  createOrGetUserSession,
  getUserWallet,
  isUserControlledConfigured,
} from '@/lib/circle/user-controlled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!isUserControlledConfigured()) {
    return NextResponse.json(
      {
        error: 'not_configured',
        message:
          'User-Controlled Wallets require CIRCLE_API_KEY + NEXT_PUBLIC_CIRCLE_APP_ID. The App ID is provisioned in Circle Console (separate from the API key).',
      },
      { status: 503 },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.userToken === 'string' && body.userToken.length > 10) {
      // Google mode — frontend already authenticated, just hydrate wallet info.
      const wallet = await getUserWallet(body.userToken).catch(() => null);
      return NextResponse.json({
        userId: null,
        userToken: body.userToken,
        encryptionKey: null, // frontend already has it from SocialLoginResult
        appId: process.env.NEXT_PUBLIC_CIRCLE_APP_ID,
        googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? null,
        wallet,
        authMethod: 'google',
      });
    }

    // PIN mode — cookie-derived user.
    const { sessionId } = await getOrCreateDemoSession();
    const session = await createOrGetUserSession(sessionId);
    const wallet = await getUserWallet(session.userToken).catch(() => null);
    return NextResponse.json({
      userId: session.userId,
      userToken: session.userToken,
      encryptionKey: session.encryptionKey,
      appId: process.env.NEXT_PUBLIC_CIRCLE_APP_ID,
      googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? null,
      wallet,
      authMethod: 'pin',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: 'session_failed', message }, { status: 500 });
  }
}
