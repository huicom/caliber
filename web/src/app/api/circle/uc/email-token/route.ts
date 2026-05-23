// POST /api/circle/uc/email-token
//
// Body: { deviceId, email }
// Returns: { deviceToken, deviceEncryptionKey, otpToken }
//
// Step 1 of Email OTP flow. Frontend gets a deviceId from sdk.getDeviceId(),
// posts here with the user's email; we exchange via Circle for the tokens
// the SDK needs to display the OTP entry modal + verify it server-side.
//
// Circle then emails a one-time code to the user. The frontend SDK opens
// its built-in OTP modal (sdk.verifyOtp()) — no OAuth redirect, no
// invisible iframe handoff, no 3rd-party-cookie issues.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserControlledClient } from '@/lib/circle/user-controlled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  deviceId: z.string().min(1),
  email: z.string().email(),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  try {
    const client = getUserControlledClient();
    const r = await client.createDeviceTokenForEmailLogin({
      deviceId: parsed.data.deviceId,
      email: parsed.data.email,
    });
    const deviceToken = r.data?.deviceToken;
    const deviceEncryptionKey = r.data?.deviceEncryptionKey;
    const otpToken = r.data?.otpToken;
    if (!deviceToken || !deviceEncryptionKey || !otpToken) {
      throw new Error('Circle returned incomplete email-login tokens');
    }
    return NextResponse.json({ deviceToken, deviceEncryptionKey, otpToken });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    const anyErr = err as { response?: { data?: unknown } };
    const detail = anyErr?.response?.data
      ? `${message} | circle: ${JSON.stringify(anyErr.response.data).slice(0, 400)}`
      : message;
    return NextResponse.json({ error: 'email_token_failed', message: detail }, { status: 500 });
  }
}
