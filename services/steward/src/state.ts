// steward_state access — the singleton key/value store. The 'frozen' flag is the
// kill switch read at the top of every payment: one Postgres read by one
// process, instant and unbypassable.

import { db, stewardState } from '@arc-agents/db';
import { eq } from 'drizzle-orm';

export interface FrozenState {
  frozen: boolean;
  reason?: string;
  by?: string;
  at?: string;
}

/** Read the 'frozen' flag. Absent row → not frozen. */
export async function readFrozen(): Promise<FrozenState> {
  const rows = await db.select().from(stewardState).where(eq(stewardState.key, 'frozen'));
  const value = rows[0]?.value as FrozenState | undefined;
  return value && typeof value.frozen === 'boolean' ? value : { frozen: false };
}
