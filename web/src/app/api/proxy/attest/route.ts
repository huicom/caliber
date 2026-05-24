// Server-side proxy for the rating API's signed-attestation endpoint.
// Client callers that don't go through the x402 flow on /jobs/new use this
// route so the bypass token stays server-side. Adds the x-x402-bypass header
// and forwards everything else through verbatim.
//
// POST /api/proxy/attest?chain=arc&id=123
// Body: { minTier?, minConfidence?, validForSeconds? }

import { NextResponse } from 'next/server';

const RATING_API_BASE =
  process.env.NEXT_PUBLIC_RATING_API_BASE ?? 'https://caliber-api.poko.blue';

export async function POST(req: Request) {
  const url = new URL(req.url);
  const chain = url.searchParams.get('chain');
  const id = url.searchParams.get('id');
  if (!chain || !id || !/^[a-z0-9_-]+$/.test(chain) || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'invalid_params' }, { status: 400 });
  }

  const body = await req.text();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.X402_BYPASS_TOKEN) {
    headers['x-x402-bypass'] = process.env.X402_BYPASS_TOKEN;
  }

  const upstream = await fetch(
    `${RATING_API_BASE}/v1/agents/${chain}/${id}/attest`,
    { method: 'POST', headers, body, cache: 'no-store' },
  );
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json' },
  });
}
