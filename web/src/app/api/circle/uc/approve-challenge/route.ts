// POST /api/circle/uc/approve-challenge
//
// Body: { userToken, walletId, budgetUsdc }
// Returns: { challengeId, approveSpender }
//
// Builds USDC.approve(RATING_GATEWAY, budget) calldata server-side via viem,
// then creates a PIN-protected challenge the frontend SDK runs.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { encodeFunctionData, type Abi } from 'viem';
import { USDC_CONTRACT, RATING_GATEWAY } from '@/lib/contracts/addresses';
import USDC_ABI from '@/lib/contracts/abis/USDC.json';
import { createContractExecutionChallenge } from '@/lib/circle/user-controlled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  userToken: z.string().min(1),
  walletId: z.string().min(1),
  budgetUsdc: z.string().regex(/^\d+(\.\d+)?$/),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const { userToken, walletId, budgetUsdc } = parsed.data;
  try {
    const budgetWei = BigInt(Math.floor(parseFloat(budgetUsdc) * 1_000_000));
    const callData = encodeFunctionData({
      abi: USDC_ABI as Abi,
      functionName: 'approve',
      args: [RATING_GATEWAY, budgetWei],
    });
    const { challengeId } = await createContractExecutionChallenge({
      userToken,
      walletId,
      contractAddress: USDC_CONTRACT as `0x${string}`,
      callData,
      refId: `caliber-uc:approve:${Date.now().toString(36)}`,
    });
    return NextResponse.json({ challengeId, approveSpender: RATING_GATEWAY });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    const anyErr = err as { response?: { data?: unknown } };
    const detail = anyErr?.response?.data
      ? `${message} | circle: ${JSON.stringify(anyErr.response.data).slice(0, 400)}`
      : message;
    return NextResponse.json({ error: 'challenge_failed', message: detail }, { status: 500 });
  }
}
