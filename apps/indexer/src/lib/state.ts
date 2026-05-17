import { db, indexerState } from '@arc-agents/db';
import { eq } from 'drizzle-orm';

const LAST_BLOCK_KEY = 'last_indexed_block';

export async function getLastIndexedBlock(defaultBlock: bigint): Promise<bigint> {
  const row = await db
    .select()
    .from(indexerState)
    .where(eq(indexerState.key, LAST_BLOCK_KEY))
    .limit(1);
  if (row.length === 0) return defaultBlock;
  return BigInt(row[0].value);
}

export async function setLastIndexedBlock(block: bigint): Promise<void> {
  await db
    .insert(indexerState)
    .values({
      key: LAST_BLOCK_KEY,
      value: block.toString(),
    })
    .onConflictDoUpdate({
      target: indexerState.key,
      set: { value: block.toString(), updatedAt: new Date() },
    });
}
