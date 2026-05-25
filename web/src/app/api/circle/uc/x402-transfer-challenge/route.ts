// POST /api/circle/uc/x402-transfer-challenge
//
// Body: { userToken, walletId }
// Returns: { challengeId, recipient, amount, priceUsdc }
//
// Step 1 of the visible Circle-path x402 flow. Hits the rating API attest
// endpoint WITHOUT the bypass token to receive a 402 + payment hint, then
// builds a Circle CONTRACT_EXECUTION challenge for USDC.transfer(recipient,
// amount) so the user's Circle wallet pays the attestation fee on-chain.
//
// Step 2 (the resulting tx hash) is sent to /api/circle/uc/post-job-challenge
// as `x402TransactionId`, which the server polls + uses as x-payment-proof
// when it actually fetches the signed attestation.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { encodeFunctionData, type Abi } from 'viem';
import { USDC_CONTRACT } from '@/lib/contracts/addresses';
import USDC_ABI from '@/lib/contracts/abis/USDC.json';
import { createContractExecutionChallenge } from '@/lib/circle/user-controlled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RATING_API_BASE =
  process.env.NEXT_PUBLIC_RATING_API_BASE ?? 'https://caliber-api.poko.blue';

const bodySchema = z.object({
  userToken: z.string().min(1),
  walletId: z.string().min(1),
  // Optional preview agent id — we only need a 402 response, not a specific
  // attestation, so any rated id (or even an unrated one) works. Default to
  // "1" since it's always valid in the schema.
  agentId: z.string().regex(/^\d+$/).optional().default('1'),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const { userToken, walletId, agentId } = parsed.data;

  try {
    // 1. Provoke a 402 from the rating API — no bypass header, no payment
    //    proof. The response body carries the canonical recipient + amount.
    const probe = await fetch(`${RATING_API_BASE}/v1/agents/arc/${agentId}/attest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minTier: 'Dormant' }), // unconditional
    });
    if (probe.status !== 402) {
      const detail = await probe.text().catch(() => '');
      return NextResponse.json(
        {
          error: 'unexpected_probe_status',
          status: probe.status,
          detail: detail.slice(0, 400),
        },
        { status: 502 },
      );
    }
    const probeBody = (await probe.json()) as {
      x402?: {
        recipient: `0x${string}`;
        amount: string;
        decimals: number;
        asset: `0x${string}`;
      };
    };
    const hint = probeBody.x402;
    if (!hint || !hint.recipient || !hint.amount) {
      return NextResponse.json(
        { error: 'malformed_402_hint', body: probeBody },
        { status: 502 },
      );
    }

    // 2. Build a Circle CONTRACT_EXECUTION challenge for USDC.transfer.
    // refId is the lookup key the browser will send back to the post-job
    // endpoint — Circle's SDK callback doesn't expose the transactionId
    // for CONTRACT_EXECUTION, so we tag it here and look it up by refId
    // after the user signs.
    const refId = `caliber-uc:x402:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
    const callData = encodeFunctionData({
      abi: USDC_ABI as Abi,
      functionName: 'transfer',
      args: [hint.recipient, BigInt(hint.amount)],
    });
    const { challengeId } = await createContractExecutionChallenge({
      userToken,
      walletId,
      contractAddress: USDC_CONTRACT as `0x${string}`,
      callData,
      refId,
    });

    // Return the hint alongside the challengeId so the UI can show the price
    // ("paying 0.001 USDC for attestation").
    const priceUsdc = (Number(BigInt(hint.amount)) / 10 ** hint.decimals).toString();

    return NextResponse.json({
      challengeId,
      refId,
      recipient: hint.recipient,
      amount: hint.amount,
      decimals: hint.decimals,
      priceUsdc,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: 'x402_challenge_failed', message }, { status: 500 });
  }
}
