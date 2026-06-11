import { NextResponse } from 'next/server';

// Lepton Phase 2 (B3): thin proxy from the Broker Console to the broker
// service (services/broker, default :3200 on the same host). Keeps the broker
// API off the public internet while letting the console trigger a match.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BROKER_URL = (process.env.BROKER_SERVICE_URL || 'http://127.0.0.1:3200').replace(/\/+$/, '');

export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_LEPTON !== '1') {
    return NextResponse.json({ error: 'not_enabled' }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }
  try {
    const r = await fetch(`${BROKER_URL}/match`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    return NextResponse.json(data, { status: r.status });
  } catch (e) {
    return NextResponse.json(
      { error: 'broker_unreachable', message: e instanceof Error ? e.message : 'broker service down' },
      { status: 502 },
    );
  }
}
