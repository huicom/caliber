// Browser session ↔ Circle wallet mapping.
//
// For the hackathon demo we don't need auth — the cookie itself binds
// a browser to a wallet. The cookie carries the random session id;
// Circle's wallet system stores everything else. A small in-memory map
// caches the latest known wallet for that session to avoid round-tripping
// to Circle on every request. The cache is process-local; if the server
// restarts, the next request just re-fetches the wallet by `refId` from
// Circle's listWallets (the refId stays stable across restarts since
// it's derived from the cookie).

import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';

const SESSION_COOKIE = 'caliber_demo_session';

export interface DemoSession {
  sessionId: string;
  /** True when the session was just created on this request. */
  isNew: boolean;
}

export async function getOrCreateDemoSession(): Promise<DemoSession> {
  const jar = await cookies();
  const existing = jar.get(SESSION_COOKIE);
  if (existing?.value) {
    return { sessionId: existing.value, isNew: false };
  }
  const sessionId = randomBytes(16).toString('hex');
  jar.set({
    name: SESSION_COOKIE,
    value: sessionId,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  });
  return { sessionId, isNew: true };
}

/** Stable ref id we tag on the Circle wallet so we can look it up again. */
export function refIdForSession(sessionId: string): string {
  return `caliber-demo:${sessionId.slice(0, 24)}`;
}
