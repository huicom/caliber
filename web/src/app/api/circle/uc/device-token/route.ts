// POST /api/circle/uc/device-token
//
// Body: { deviceId }  (from sdk.getDeviceId() on the client)
// Returns: { deviceToken, deviceEncryptionKey }
//
// Step 1 of the Google social-login flow: the W3S Web SDK generates a
// per-browser deviceId; the backend exchanges it for temporary tokens
// that authorize the SDK to run Google OAuth on Circle's behalf.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserControlledClient } from '@/lib/circle/user-controlled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ deviceId: z.string().min(1) });

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  try {
    const c = getUserControlledClient();
    const r = await c.createDeviceTokenForSocialLogin({ deviceId: parsed.data.deviceId });
    const deviceToken = r.data?.deviceToken;
    const deviceEncryptionKey = r.data?.deviceEncryptionKey;
    if (!deviceToken || !deviceEncryptionKey) {
      throw new Error('Circle returned no deviceToken / deviceEncryptionKey');
    }
    return NextResponse.json({ deviceToken, deviceEncryptionKey });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    const anyErr = err as { response?: { data?: unknown } };
    const detail = anyErr?.response?.data
      ? `${message} | circle: ${JSON.stringify(anyErr.response.data).slice(0, 400)}`
      : message;
    return NextResponse.json({ error: 'device_token_failed', message: detail }, { status: 500 });
  }
}
