// POST /api/circle/uc/deposit-approve-challenge
//
// Body: { userToken, walletId, amountUsdc }
// Returns: { challengeId, refId, gatewayWalletAddress, depositAmountWei }
//
// Step 1 of the Gateway Balance deposit flow. Creates a Circle
// CONTRACT_EXECUTION challenge for USDC.approve(GATEWAY_WALLET, amount).
// User signs in their Circle modal. Then the deposit-challenge endpoint
// creates the actual deposit transaction.
//
// Two-step pattern matches Circle SDK's GatewayClient.deposit() — approve
// first because GatewayWallet pulls USDC via transferFrom.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { encodeFunctionData, parseUnits, type Abi } from 'viem';
import { USDC_CONTRACT } from '@/lib/contracts/addresses';
import USDC_ABI from '@/lib/contracts/abis/USDC.json';
import {
  createContractExecutionChallenge,
  TESTNET_GATEWAY_WALLET,
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
      abi: USDC_ABI as Abi,
      functionName: 'approve',
      args: [TESTNET_GATEWAY_WALLET, amountWei],
    });
    const refId = `caliber-uc:gw-approve:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
    const { challengeId } = await createContractExecutionChallenge({
      userToken,
      walletId,
      contractAddress: USDC_CONTRACT as `0x${string}`,
      callData,
      refId,
    });
    return NextResponse.json({
      challengeId,
      refId,
      gatewayWalletAddress: TESTNET_GATEWAY_WALLET,
      depositAmountWei: amountWei.toString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json(
      { error: 'gw_approve_challenge_failed', message },
      { status: 500 },
    );
  }
}
