import { db, indexerState } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { ok, serverError } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const startTime = Date.now();
    const result = await db
      .select()
      .from(indexerState)
      .where(eq(indexerState.key, 'last_indexed_block'))
      .limit(1);
    const dbLatencyMs = Date.now() - startTime;

    const lastBlock = result[0]?.value ?? '0';
    const lastUpdate = result[0]?.updatedAt ?? null;
    const ageMs = lastUpdate
      ? Date.now() - new Date(lastUpdate).getTime()
      : Infinity;
    const indexerHealthy = ageMs < 60_000;

    return ok({
      status: indexerHealthy ? 'ok' : 'degraded',
      db: { connected: true, latencyMs: dbLatencyMs },
      indexer: {
        lastBlock,
        lastUpdate,
        ageSeconds: Math.floor(ageMs / 1000),
        healthy: indexerHealthy,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return serverError('Health check failed', err);
  }
}
