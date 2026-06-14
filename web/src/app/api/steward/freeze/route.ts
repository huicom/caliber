import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireConsoleKey } from '@/lib/steward-console-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// The treasury freeze flag. Single row in `steward_state` at key 'frozen' with
// shape { frozen, reason?, by?, at? }. When frozen, the services/steward
// pipeline denies every payment at the first stage. Toggling here also fires a
// `steward_events` notify so every open console reconciles instantly.
//
// AUTH: the POST handler is gated by requireConsoleKey (x-steward-console-key
// header). GET (read freeze state) stays open. Judges drive the demo with the
// shared console key; anonymous public traffic on steward.poko.blue cannot toggle.

const FREEZE_KEY = 'frozen';

interface FreezeState {
  frozen: boolean;
  reason?: string | null;
  by?: string;
  at?: string;
}

async function readFreeze(): Promise<FreezeState> {
  const rows = await sql<{ value: FreezeState }[]>`
    SELECT value FROM steward_state WHERE key = ${FREEZE_KEY} LIMIT 1`;
  return rows[0]?.value ?? { frozen: false };
}

export async function GET() {
  const state = await readFreeze();
  return NextResponse.json(state);
}

export async function POST(req: Request) {
  const denied = requireConsoleKey(req);
  if (denied) return denied;

  let body: { frozen?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (typeof body.frozen !== 'boolean') {
    return NextResponse.json(
      { error: 'body must include { frozen: boolean }' },
      { status: 400 },
    );
  }

  const frozen = body.frozen;
  const reason =
    typeof body.reason === 'string' && body.reason.trim().length > 0
      ? body.reason.trim()
      : null;

  const value: FreezeState = {
    frozen,
    reason,
    by: 'console',
    at: new Date().toISOString(),
  };
  const json = JSON.stringify(value);

  await sql`
    INSERT INTO steward_state (key, value, updated_at)
    VALUES (${FREEZE_KEY}, ${json}::jsonb, now())
    ON CONFLICT (key)
    DO UPDATE SET value = ${json}::jsonb, updated_at = now()`;

  const notify = JSON.stringify({ kind: 'freeze', frozen, reason });
  await sql`SELECT pg_notify('steward_events', ${notify})`;

  return NextResponse.json(value);
}
