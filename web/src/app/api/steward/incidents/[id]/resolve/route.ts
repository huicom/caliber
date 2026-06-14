import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Resolve a Steward incident: set status='resolved', stamp resolved_at + a
// resolved_by source. Used by the console's optimistic resolve button.
//
// TODO auth — v0 is unauthenticated on purpose, consistent with the freeze
// route: the hackathon judges must be able to drive this themselves. Gate
// before any real funds flow through Steward.

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const rows = await sql<{ id: string; status: string }[]>`
    UPDATE steward_incidents
    SET status = 'resolved', resolved_at = now(), resolved_by = 'console'
    WHERE id = ${id}::bigint
    RETURNING id::text, status`;

  if (rows.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  return NextResponse.json({ id: rows[0].id, status: rows[0].status });
}
