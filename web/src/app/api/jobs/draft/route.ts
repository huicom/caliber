import { NextRequest, NextResponse } from 'next/server';
import { db, jobDrafts } from '@/lib/db';
import { keccak256, toBytes } from 'viem';

/**
 * POST /api/jobs/draft
 *
 * Persists a job draft (title + 2000-char description + budget + deadline)
 * off-chain and returns a keccak256 `draftHash`. The hash is then embedded
 * in the on-chain `JobCreated.description` via the
 * `arcagents:draft:<hash>` marker so the indexer can join the rich draft
 * data back to the on-chain job after it fires. Wave 1 caliber rebuild.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      title,
      description,
      budgetUsdc,
      minTier,
      minConfidence,
      chainId,
      poster,
      targetAgentId,
      deadline,
      bondRequired,
    } = body;

    if (!title || typeof title !== 'string' || title.length === 0 || title.length > 60) {
      return NextResponse.json({ error: 'title must be 1-60 characters' }, { status: 400 });
    }
    if (
      !description ||
      typeof description !== 'string' ||
      description.length === 0 ||
      description.length > 2000
    ) {
      return NextResponse.json(
        { error: 'description must be 1-2000 characters' },
        { status: 400 },
      );
    }
    if (!budgetUsdc || typeof budgetUsdc !== 'string') {
      return NextResponse.json({ error: 'budgetUsdc is required' }, { status: 400 });
    }
    const budget = parseFloat(budgetUsdc);
    if (isNaN(budget) || budget < 1 || budget > 1000) {
      return NextResponse.json({ error: 'budget must be 1-1000 USDC' }, { status: 400 });
    }
    if (minTier == null || typeof minTier !== 'number' || minTier < 0 || minTier > 8) {
      return NextResponse.json({ error: 'minTier must be 0-8' }, { status: 400 });
    }
    if (
      minConfidence == null ||
      typeof minConfidence !== 'number' ||
      minConfidence < 0 ||
      minConfidence > 2
    ) {
      return NextResponse.json({ error: 'minConfidence must be 0-2' }, { status: 400 });
    }
    if (!poster || typeof poster !== 'string' || !poster.startsWith('0x')) {
      return NextResponse.json({ error: 'poster must be a valid address' }, { status: 400 });
    }
    if (!targetAgentId || typeof targetAgentId !== 'string') {
      return NextResponse.json({ error: 'targetAgentId is required' }, { status: 400 });
    }
    if (!deadline || typeof deadline !== 'string') {
      return NextResponse.json({ error: 'deadline is required' }, { status: 400 });
    }
    const deadlineDate = new Date(deadline);
    if (isNaN(deadlineDate.getTime()) || deadlineDate.getTime() < Date.now()) {
      return NextResponse.json({ error: 'deadline must be a future date' }, { status: 400 });
    }

    const draftHash = keccak256(
      toBytes(JSON.stringify({ title, description, budgetUsdc, deadline })),
    );

    const [draft] = await db
      .insert(jobDrafts)
      .values({
        draftHash,
        chainId: chainId || 'arc',
        poster: poster.toLowerCase(),
        targetAgentId,
        title,
        description,
        budgetUsdc,
        minTier,
        minConfidence,
        deadline: deadlineDate,
        bondRequired: bondRequired === true,
      })
      .returning();

    return NextResponse.json(
      { draftId: draft.draftId, draftHash: draft.draftHash },
      { status: 201 },
    );
  } catch (err) {
    console.error('Error creating job draft:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
