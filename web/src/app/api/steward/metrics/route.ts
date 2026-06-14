import { NextResponse } from 'next/server';
import { getStewardMetrics } from '@/lib/steward-metrics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

// Steward traction counters — the JSON behind the public numbers on /steward.
// Shares every query with the overview page via getStewardMetrics(), so the
// API and the page can never disagree. Honest split: 'hirebot' source is our
// own dogfood agent (demo); everything else is external integration traffic.

export async function GET() {
  if (process.env.NEXT_PUBLIC_STEWARD !== '1') {
    return NextResponse.json({ error: 'not_enabled' }, { status: 404 });
  }
  const metrics = await getStewardMetrics();
  return NextResponse.json(metrics);
}
