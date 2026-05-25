// POST /api/circle/uc/deposit-challenge
//
// Body: { userToken, walletId, amountUsdc }
// Returns: { challengeId, refId }
//
// Step 2 of the Gateway Balance deposit flow. Creates a Circle
// CONTRACT_EXECUTION challenge for GatewayWallet.deposit(USDC, amount).
// Requires the user to have already signed the approve-challenge in step 1.
// User signs this challenge in their Circle modal → tx submits → Gateway
// Balance accrues at the user's address (queryable via Circle's
// /v1/balances endpoint).
//
// After this transaction lands, the user's Gateway Balance can pay for
// x402 attestations via signed EIP-3009 TransferWithAuthorization.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { encodeFunctionData, parseUnits } from 'viem';
import { USDC_CONTRACT } from '@/lib/contracts/addresses';
import {
  createContractExecutionChallenge,
  TESTNET_GATEWAY_WALLET,
  GATEWAY_WALLET_ABI,
} from '@/lib/circle/user-controlled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  userToken: z.string().min(1),
  walletId: z.string().min(1),
  amountUsdc: z.string().regex(/^\d+(\.\d+)?$/),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const { userToken, walletId, amountUsdc } = parsed.data;
  try {
    const amountWei = parseUnits(amountUsdc, 6);
    const callData = encodeFunctionData({
      abi: GATEWAY_WALLET_ABI,
      functionName: 'deposit',
      args: [USDC_CONTRACT as `0x${string}`, amountWei],
    });
    const refId = `caliber-uc:gw-deposit:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
    const { challengeId } = await createContractExecutionChallenge({
      userToken,
      walletId,
      contractAddress: TESTNET_GATEWAY_WALLET,
      callData,
      refId,
    });
    return NextResponse.json({ challengeId, refId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json(
      { error: 'gw_deposit_challenge_failed', message },
      { status: 500 },
    );
  }
}
