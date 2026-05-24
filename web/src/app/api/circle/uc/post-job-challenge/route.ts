// POST /api/circle/uc/post-job-challenge
//
// Body: full job form payload + walletId/userToken/posterAddress.
// Returns: { challengeId, draftHash }
//
// Persists the off-chain draft, fetches a signed RatingAttestation from the
// rating service, encodes postGatedJob calldata server-side, creates a
// PIN-protected challenge. Frontend runs the challenge; on success polls
// for the JobPostedWithRating event and routes to /jobs/[jobId].

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { encodeFunctionData, type Abi } from 'viem';
import { RATING_GATEWAY } from '@/lib/contracts/addresses';
import RatingGateway_ABI from '@/lib/contracts/abis/RatingGateway.json';
import { createContractExecutionChallenge } from '@/lib/circle/user-controlled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const RATING_API_BASE =
  process.env.NEXT_PUBLIC_RATING_API_BASE ?? 'https://caliber-api.poko.blue';

const bodySchema = z.object({
  userToken: z.string().min(1),
  walletId: z.string().min(1),
  posterAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  title: z.string().min(1).max(60),
  description: z.string().min(1).max(2000),
  budgetUsdc: z.string().regex(/^\d+(\.\d+)?$/),
  minTier: z.enum(['Gold', 'Silver', 'Bronze', 'Pending']).default('Pending'),
  minConfidence: z.enum(['high', 'moderate', 'low']).default('moderate'),
  targetAgentId: z.string().regex(/^\d+$/),
  evaluatorAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  deadline: z.string().optional(),
  bondRequired: z.boolean().optional(),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }
  const body = parsed.data;

  try {
    // Defaults so basic mode works with minimum input.
    const evaluatorAddress = body.evaluatorAddress ?? body.posterAddress;
    const deadlineIso =
      body.deadline ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const budgetWei = BigInt(Math.floor(parseFloat(body.budgetUsdc) * 1_000_000));

    // 1. Persist draft
    const internalBase = process.env.INTERNAL_API_BASE ?? 'http://localhost:3000';
    const draftRes = await fetch(`${internalBase}/api/jobs/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: body.title,
        description: body.description,
        budgetUsdc: body.budgetUsdc,
        minTier: ['Gold', 'Silver', 'Bronze', 'Pending'].indexOf(body.minTier),
        minConfidence: ['high', 'moderate', 'low'].indexOf(body.minConfidence),
        chainId: 'arc',
        poster: body.posterAddress,
        targetAgentId: body.targetAgentId,
        deadline: new Date(deadlineIso).toISOString(),
        bondRequired: body.bondRequired === true,
      }),
    });
    if (!draftRes.ok) {
      return NextResponse.json(
        { error: 'draft_failed', message: `draft endpoint returned ${draftRes.status}` },
        { status: 502 },
      );
    }
    const { draftHash } = (await draftRes.json()) as { draftHash: string };

    // 2. Fetch signed attestation. Server-to-server bypass token skips
    // x402 — Circle UC flow already has its own per-tx server signing.
    const attestHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.X402_BYPASS_TOKEN) {
      attestHeaders['x-x402-bypass'] = process.env.X402_BYPASS_TOKEN;
    }
    const attestRes = await fetch(
      `${RATING_API_BASE}/v1/agents/arc/${body.targetAgentId}/attest`,
      {
        method: 'POST',
        headers: attestHeaders,
        body: JSON.stringify({ minTier: body.minTier, minConfidence: body.minConfidence }),
      },
    );
    if (!attestRes.ok) {
      const errBody = await attestRes.json().catch(() => ({}));
      return NextResponse.json(
        {
          error: 'attestation_refused',
          status: attestRes.status,
          reason: errBody.reason ?? 'unknown',
          detail: errBody.detail ?? null,
        },
        { status: 422 },
      );
    }
    const att = (await attestRes.json()) as {
      attestation: {
        chain: `0x${string}`;
        agentId: string;
        agentAddress: `0x${string}`;
        tier: number;
        score: number;
        interactionCount: number;
        flags: number;
        methodologyVersion: `0x${string}`;
        asOf: string;
        validUntil: string;
        nonce: string;
      };
      signature: `0x${string}`;
    };

    // 3. Encode postGatedJob calldata
    const expiredAt = BigInt(Math.floor(new Date(deadlineIso).getTime() / 1000));
    const onchainDescription = `${body.title}\n\narcagents:draft:${draftHash}`;
    const minTierOrdinal = ['Gold', 'Silver', 'Bronze', 'Pending'].indexOf(body.minTier);

    const callData = encodeFunctionData({
      abi: RatingGateway_ABI as Abi,
      functionName: 'postGatedJob',
      args: [
        att.attestation.agentAddress,
        evaluatorAddress as `0x${string}`,
        expiredAt,
        onchainDescription,
        budgetWei,
        {
          chain: att.attestation.chain,
          agentId: BigInt(att.attestation.agentId),
          agentAddress: att.attestation.agentAddress,
          tier: att.attestation.tier,
          score: att.attestation.score,
          interactionCount: att.attestation.interactionCount,
          flags: att.attestation.flags,
          methodologyVersion: att.attestation.methodologyVersion,
          asOf: BigInt(att.attestation.asOf),
          validUntil: BigInt(att.attestation.validUntil),
          nonce: BigInt(att.attestation.nonce),
        },
        att.signature,
        minTierOrdinal,
        0,
      ],
    });

    // 4. Create the PIN-protected challenge
    const { challengeId } = await createContractExecutionChallenge({
      userToken: body.userToken,
      walletId: body.walletId,
      contractAddress: RATING_GATEWAY as `0x${string}`,
      callData,
      refId: `caliber-uc:post:${draftHash.slice(0, 12)}`,
    });

    return NextResponse.json({ challengeId, draftHash });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    const anyErr = err as { response?: { data?: unknown } };
    const detail = anyErr?.response?.data
      ? `${message} | circle: ${JSON.stringify(anyErr.response.data).slice(0, 400)}`
      : message;
    return NextResponse.json({ error: 'challenge_failed', message: detail }, { status: 500 });
  }
}
