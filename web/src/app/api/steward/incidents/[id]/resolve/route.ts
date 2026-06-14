import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireConsoleKey } from '@/lib/steward-console-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Resolve a Steward incident: set status='resolved', stamp resolved_at + a
// resolved_by source. Used by the console's optimistic resolve button.
//
// AUTH: gated by requireConsoleKey (x-steward-console-key header). Judges drive
// the demo with the shared console key; anonymous public traffic cannot resolve.

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = requireConsoleKey(req);
  if (denied) return denied;

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
