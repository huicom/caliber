// POST /api/circle/uc/email-resend
//
// Body: { deviceId, email, otpToken }
// Returns: { otpToken } (a new one)
//
// If the user's OTP email gets lost / spam folder, the SDK calls our
// resend handler. We forward to Circle's resendOTP which issues a fresh
// otpToken (the old one is invalidated).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserControlledClient } from '@/lib/circle/user-controlled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  deviceId: z.string().min(1),
  email: z.string().email(),
  otpToken: z.string().min(1),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  try {
    const client = getUserControlledClient();
    // SDK type insists on userToken but the actual API works with just
    // device + email + otpToken pre-auth (user hasn't verified yet).
    // Cast to bypass the type check.
    const r = await client.resendOTP({
      deviceId: parsed.data.deviceId,
      email: parsed.data.email,
      otpToken: parsed.data.otpToken,
      userToken: '',
    } as Parameters<typeof client.resendOTP>[0]);
    const otpToken = r.data?.otpToken;
    if (!otpToken) throw new Error('Circle resendOTP returned no otpToken');
    return NextResponse.json({ otpToken });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: 'email_resend_failed', message }, { status: 500 });
  }
}
