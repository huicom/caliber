// GET /api/audit/posts?poster=0x...&limit=20
//
// Audit trail of jobs posted by a given address. Pulls from the indexer's
// jobs table (populated from on-chain JobPostedWithRating events) — same
// source of truth as /jobs/[id]. Returns the most-recent posts first.
//
// Use cases:
//   - Demo: confirm a just-posted job actually landed on-chain even if the
//     browser-side getLogs scan timed out
//   - Support: trace which jobs a wallet has posted (creation block, tx
//     hash, budget, status)
//   - Post-mortem: line up x402 payments (in arc-web.log) with the
//     resulting on-chain post
//
// Future: extend with x402 payment join once we persist x402 receipts in
// a dedicated table. Today, x402 payments are visible in arc-web.log and
// /var/log/arc-rating.log.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { jobs } from '@arc-agents/db';
import { eq, desc, and } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const poster = url.searchParams.get('poster')?.toLowerCase();
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '20'), 100);
  const chain = url.searchParams.get('chain') ?? 'arc';

  if (!poster || !/^0x[a-f0-9]{40}$/.test(poster)) {
    return NextResponse.json({ error: 'bad_poster' }, { status: 400 });
  }

  try {
    const rows = await db
      .select({
        jobId: jobs.jobId,
        chainId: jobs.chainId,
        provider: jobs.providerAddress,
        evaluator: jobs.evaluatorAddress,
        budgetUsdc: jobs.budgetUsdc,
        description: jobs.description,
        status: jobs.status,
        createdAtBlock: jobs.createdAtBlock,
        createdTxHash: jobs.createdTxHash,
        createdAt: jobs.createdAt,
      })
      .from(jobs)
      .where(and(eq(jobs.clientAddress, poster), eq(jobs.chainId, chain)))
      .orderBy(desc(jobs.createdAtBlock))
      .limit(limit);

    return NextResponse.json({
      poster,
      chain,
      count: rows.length,
      jobs: rows.map((r) => ({
        ...r,
        jobId: r.jobId.toString(),
        createdAtBlock: r.createdAtBlock.toString(),
      })),
      note:
        'x402 payment receipts are in /var/log/arc-rating.log (server-side) and /var/log/arc-web.log (client-orchestrated Circle PW flows).',
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'query_failed', message: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
