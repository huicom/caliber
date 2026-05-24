// POST /api/circle/demo-gated-job
//
// Server-orchestrated equivalent of the three-popup gated-job flow on
// /jobs/new, executed via the session's Circle Programmable Wallet
// instead of MetaMask. The judge clicks one button; Circle's API key
// signs the USDC.approve and the RatingGateway.postGatedJob calls on
// the wallet's behalf.
//
// Flow:
//   1. Get-or-create session's Circle wallet (and faucet it on first use)
//   2. Persist off-chain job draft (same shape as /api/jobs/draft)
//   3. Fetch signed RatingAttestation from the rating service
//   4. USDC.approve(RatingGateway, budget) via Circle
//   5. Poll until COMPLETE/CONFIRMED
//   6. RatingGateway.postGatedJob(...) via Circle
//   7. Poll until COMPLETE/CONFIRMED, read the tx receipt, decode
//      JobPostedWithRating to extract jobId
//   8. Return jobId + both tx hashes

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createPublicClient,
  http,
  decodeEventLog,
  type Abi,
} from 'viem';
import { arcTestnet } from '@/lib/wagmi/chains';
import { USDC_CONTRACT, RATING_GATEWAY } from '@/lib/contracts/addresses';
import USDC_ABI from '@/lib/contracts/abis/USDC.json';
import RatingGateway_ABI from '@/lib/contracts/abis/RatingGateway.json';
import { getOrCreateDemoSession } from '@/lib/circle/session';
import {
  getOrCreateWallet,
  ensureFunded,
  executeContractCall,
  getTransactionStatus,
  type TransactionStatus,
} from '@/lib/circle/wallet-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120; // seconds — Circle txns + 2 confirmations can take 60-90s

const RATING_API_BASE =
  process.env.NEXT_PUBLIC_RATING_API_BASE ?? 'https://caliber-api.poko.blue';

const bodySchema = z.object({
  title: z.string().min(1).max(60),
  description: z.string().min(1).max(2000),
  budgetUsdc: z.string().regex(/^\d+(\.\d+)?$/),
  minTier: z.enum(['Gold', 'Silver', 'Bronze', 'Pending']).default('Pending'),
  minConfidence: z.enum(['high', 'moderate', 'low']).default('moderate'),
  targetAgentId: z.string().regex(/^\d+$/),
  // Optional. Server defaults to the Circle wallet itself (self-eval) when
  // empty so judges can click "run demo" without having to know an address.
  evaluatorAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional()
    .or(z.literal(''))
    .or(z.undefined()),
  // Optional. Defaults to now + 7 days if not provided.
  deadline: z.string().optional(),
});

async function waitForTransaction(id: string, label: string): Promise<TransactionStatus> {
  const deadline = Date.now() + 90_000; // 90s ceiling per tx
  let status: TransactionStatus;
  for (;;) {
    status = await getTransactionStatus(id);
    if (status.state === 'COMPLETE' || status.state === 'CONFIRMED') return status;
    if (status.state === 'FAILED' || status.state === 'CANCELLED' || status.state === 'DENIED') {
      throw new Error(`${label} ${status.state.toLowerCase()}: ${status.errorReason ?? 'unknown'}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`${label} timed out after 90s (last state: ${status.state})`);
    }
    await new Promise((r) => setTimeout(r, 2_500));
  }
}

export async function POST(req: Request) {
  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid_body', message: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }
    const body = parsed.data;
    const budgetWei = BigInt(Math.floor(parseFloat(body.budgetUsdc) * 1_000_000));

    // 1. Session + wallet. Check balance — Circle's programmatic faucet
    //    returns 403 on Arc Testnet, so the only way to fund a wallet is
    //    via the human-facing https://faucet.circle.com (10 USDC per
    //    request, 2h rate limit). When balance is 0 we surface the
    //    faucet URL with the wallet address so the user can fund and retry.
    const { sessionId } = await getOrCreateDemoSession();
    const wallet = await getOrCreateWallet(sessionId);
    const funding = await ensureFunded(wallet.id, wallet.address);
    if (!funding.funded) {
      return NextResponse.json(
        {
          error: 'wallet_unfunded',
          message:
            `Demo wallet has no testnet USDC. Fund it once via the Arc Testnet faucet, then retry.`,
          walletAddress: wallet.address,
          faucetUrl: 'https://faucet.circle.com',
        },
        { status: 402 }, // 402 Payment Required — semantically right
      );
    }

    // Defaults so the demo button works with minimum form input.
    const evaluatorAddress =
      body.evaluatorAddress && body.evaluatorAddress.length === 42
        ? body.evaluatorAddress
        : wallet.address; // self-eval — wallet evaluates its own job in the demo
    const deadlineIso =
      body.deadline ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // 2. Save off-chain draft (same shape as /api/jobs/draft).
    // Self-call: use localhost, not req.url. The external host (Cloudflare)
    // would attempt to re-enter the VM and fails with "fetch failed".
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
        poster: wallet.address,
        targetAgentId: body.targetAgentId,
        deadline: new Date(deadlineIso).toISOString(),
      }),
    });
    if (!draftRes.ok) {
      return NextResponse.json(
        { error: 'draft_failed', message: `draft endpoint returned ${draftRes.status}` },
        { status: 502 },
      );
    }
    const { draftHash } = (await draftRes.json()) as { draftHash: string };

    // 3. Fetch signed RatingAttestation.
    const attestRes = await fetch(
      `${RATING_API_BASE}/v1/agents/arc/${body.targetAgentId}/attest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    const attData = (await attestRes.json()) as {
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

    // 4. USDC.approve(RatingGateway, budget) — server-orchestrated popup #1.
    const approveTxId = await executeContractCall({
      walletId: wallet.id,
      contractAddress: USDC_CONTRACT as `0x${string}`,
      abi: USDC_ABI as Abi,
      functionName: 'approve',
      args: [RATING_GATEWAY, budgetWei],
      refId: `caliber-demo:approve:${draftHash.slice(0, 12)}`,
    });
    const approveStatus = await waitForTransaction(approveTxId, 'USDC approve');

    // 5. RatingGateway.postGatedJob(...) — server-orchestrated popup #2.
    const expiredAt = BigInt(Math.floor(new Date(deadlineIso).getTime() / 1000));
    const onchainDescription = `${body.title}\n\narcagents:draft:${draftHash}`;
    const minTierOrdinal = ['Gold', 'Silver', 'Bronze', 'Pending'].indexOf(body.minTier);

    const postTxId = await executeContractCall({
      walletId: wallet.id,
      contractAddress: RATING_GATEWAY as `0x${string}`,
      abi: RatingGateway_ABI as Abi,
      functionName: 'postGatedJob',
      args: [
        attData.attestation.agentAddress,
        evaluatorAddress as `0x${string}`,
        expiredAt,
        onchainDescription,
        budgetWei,
        {
          chain: attData.attestation.chain,
          agentId: BigInt(attData.attestation.agentId),
          agentAddress: attData.attestation.agentAddress,
          tier: attData.attestation.tier,
          score: attData.attestation.score,
          interactionCount: attData.attestation.interactionCount,
          flags: attData.attestation.flags,
          methodologyVersion: attData.attestation.methodologyVersion,
          asOf: BigInt(attData.attestation.asOf),
          validUntil: BigInt(attData.attestation.validUntil),
          nonce: BigInt(attData.attestation.nonce),
        },
        attData.signature,
        minTierOrdinal,
        0, // blockingFlagMask
      ],
      refId: `caliber-demo:post:${draftHash.slice(0, 12)}`,
    });
    const postStatus = await waitForTransaction(postTxId, 'postGatedJob');

    // 6. Read the tx receipt and decode JobPostedWithRating to get the jobId.
    let jobId: string | null = null;
    if (postStatus.txHash) {
      try {
        const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: postStatus.txHash as `0x${string}`,
        });
        const gatewayLower = (RATING_GATEWAY as string).toLowerCase();
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== gatewayLower) continue;
          try {
            const decoded = decodeEventLog({
              abi: RatingGateway_ABI as Abi,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === 'JobPostedWithRating') {
              const args = decoded.args as unknown as { jobId: bigint };
              jobId = args.jobId.toString();
              break;
            }
          } catch {
            // not our event
          }
        }
      } catch (receiptErr) {
        console.warn('Receipt decode failed:', receiptErr);
      }
    }

    return NextResponse.json({
      ok: true,
      wallet: { address: wallet.address, id: wallet.id, isNew: wallet.isNew },
      jobId,
      approveTxHash: approveStatus.txHash,
      postTxHash: postStatus.txHash,
      draftHash,
    });
  } catch (err) {
    let message = err instanceof Error ? err.message : 'unknown error';
    // Surface Circle's actual API response body (axios errors carry it).
    // Without this we lose all signal ("Request failed with status code 400"
    // is useless on its own — Circle's body has the real reason).
    const anyErr = err as { response?: { data?: unknown; status?: number } };
    if (anyErr?.response?.data) {
      try {
        message = `${message} | circle: ${JSON.stringify(anyErr.response.data).slice(0, 800)}`;
      } catch {
        // ignore stringify failure
      }
    }
    console.error('[demo-gated-job] error:', message);
    const status =
      message.includes('CIRCLE_API_KEY') || message.includes('CIRCLE_DEMO_WALLET_SET_ID')
        ? 503
        : 500;
    return NextResponse.json({ error: 'demo_failed', message }, { status });
  }
}
