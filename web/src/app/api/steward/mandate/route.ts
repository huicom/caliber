import { NextResponse } from 'next/server';
import { requireConsoleKey } from '@/lib/steward-console-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Console proxy to the Steward service mandate API. The steward service holds
// the LLM mandate-compiler and the policy store; the web app never talks to it
// directly from the browser, so the x-steward-key stays server-side here.
//
//   GET  → proxies services/steward GET /v1/policy  (active mandate + policy)
//   POST → proxies services/steward POST /v1/mandate (compile + activate)
//
// We pass the upstream status codes straight through (notably 502 compile_failed
// and 503 treasurer_disabled) so the client can branch on them with the right
// copy. If the steward service is unreachable (not yet deployed), we surface a
// 503 of our own kind so the editor degrades gracefully instead of throwing.
//
// AUTH: the POST handler (compile + activate a new policy) is gated by
// requireConsoleKey (x-steward-console-key header). GET (read active policy)
// stays open. Judges drive the demo with the shared console key.

const STEWARD_BASE_URL =
  process.env.STEWARD_BASE_URL ?? 'http://localhost:3300';
const STEWARD_API_KEY = process.env.STEWARD_API_KEY ?? '';

function authHeaders(): HeadersInit {
  return {
    'content-type': 'application/json',
    'x-steward-key': STEWARD_API_KEY,
  };
}

export async function GET() {
  if (process.env.NEXT_PUBLIC_STEWARD !== '1') {
    return NextResponse.json({ error: 'not_enabled' }, { status: 404 });
  }

  try {
    const upstream = await fetch(`${STEWARD_BASE_URL}/v1/policy`, {
      method: 'GET',
      headers: authHeaders(),
      cache: 'no-store',
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch {
    return NextResponse.json(
      { error: 'steward_unreachable', detail: 'The Steward service is not responding.' },
      { status: 503 },
    );
  }
}

export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_STEWARD !== '1') {
    return NextResponse.json({ error: 'not_enabled' }, { status: 404 });
  }

  const denied = requireConsoleKey(req);
  if (denied) return denied;

  let body: { rawText?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (typeof body.rawText !== 'string' || body.rawText.trim().length === 0) {
    return NextResponse.json(
      { error: 'body must include a non-empty { rawText: string }' },
      { status: 400 },
    );
  }

  try {
    const upstream = await fetch(`${STEWARD_BASE_URL}/v1/mandate`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ rawText: body.rawText }),
      cache: 'no-store',
    });
    const text = await upstream.text();
    // Pass the upstream status through verbatim — 200 / 502 / 503 / 4xx — so the
    // client renders the right state (success, compile_failed, treasurer_disabled).
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch {
    return NextResponse.json(
      {
        error: 'steward_unreachable',
        detail:
          'The Steward service is not responding — your active mandate is still enforced.',
      },
      { status: 503 },
    );
  }
}
