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
import {
  createContractExecutionChallenge,
  getUserTransactionStatus,
  findTransactionByRefId,
  pollChallengeSignature,
} from '@/lib/circle/user-controlled';
import { encodePaymentSignatureHeader } from '@x402/core/http';

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
  minConfidence: z.enum(['high', 'moderate', 'low', 'insufficient']).default('insufficient'),
  targetAgentId: z.string().regex(/^\d+$/),
  evaluatorAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  deadline: z.string().optional(),
  bondRequired: z.boolean().optional(),
  // When set, the server polls Circle for the on-chain tx hash of this
  // transactionId and uses it as x-payment-proof against the rating API's
  // x402 paywall, instead of the bypass token. Lets the Circle path
  // exercise the real x402 verification path end-to-end.
  x402TransactionId: z.string().optional(),
  // Alternative path: Circle's SDK callback for CONTRACT_EXECUTION doesn't
  // surface the transactionId, so the browser sends the refId we tagged
  // the challenge with, and the server looks up the transaction itself.
  x402RefId: z.string().optional(),
  // Circle Programmable Wallet x402: browser ran a signTypedData challenge
  // to sign an EIP-3009 TransferWithAuthorization. The server polls Circle
  // for the resulting signature (or accepts it inline from the browser's
  // SDK callback), then builds the X-PAYMENT header and uses Circle
  // Gateway's facilitator to verify + settle.
  x402SignChallengeId: z.string().optional(),
  x402Signature: z.string().optional(),
  x402Authorization: z
    .object({
      from: z.string(),
      to: z.string(),
      value: z.string(),
      validAfter: z.string(),
      validBefore: z.string(),
      nonce: z.string(),
    })
    .optional(),
  x402Network: z.string().optional(),
  x402Scheme: z.string().optional(),
  x402Version: z.number().optional(),
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
        minConfidence: ['high', 'moderate', 'low', 'insufficient'].indexOf(body.minConfidence),
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

    // 2. Fetch signed attestation. Three modes:
    //    (a) x402SignChallengeId + (optional inline) x402Signature → real
    //        Circle Gateway flow. Build X-PAYMENT from the EIP-3009
    //        TransferWithAuthorization signature. Circle Gateway's
    //        facilitator verifies the signature and queues for batched
    //        settlement to the Seller Wallet's Gateway Balance.
    //    (b) x402TransactionId / x402RefId → legacy on-chain proof path
    //        (USDC.transfer tx hash). Kept for backward compat with the
    //        homegrown x402 variant.
    //    (c) None of the above → bypass token (server-to-server trusted
    //        caller).
    const attestHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (body.x402SignChallengeId) {
      // Resolve the signature. Prefer the inline value (browser pulled it
      // from the SDK execute callback); fall back to polling Circle.
      let signature = body.x402Signature ?? null;
      if (!signature) {
        const poll = await pollChallengeSignature(body.userToken, body.x402SignChallengeId);
        if (poll.status !== 'COMPLETE' || !poll.signature) {
          return NextResponse.json(
            {
              error: 'x402_signature_unavailable',
              detail: poll.errorMessage ?? `challenge ${poll.status}`,
            },
            { status: 504 },
          );
        }
        signature = poll.signature;
      }
      if (!body.x402Authorization || !body.x402Network || !body.x402Scheme) {
        return NextResponse.json(
          { error: 'x402_payload_incomplete', detail: 'missing authorization / network / scheme' },
          { status: 400 },
        );
      }
      // Circle Gateway facilitator's /v1/x402/verify REQUIRES resource +
      // accepted fields on the paymentPayload even though they're optional
      // in @x402/core's TypeScript type. Without them: "paymentPayload.
      // resource: Required, paymentPayload.accepted: Required" → 4xx →
      // bubbles up as unhelpful 402. We reconstruct from what x402-sign-
      // challenge already established.
      const acceptedRequirement = {
        scheme: body.x402Scheme,
        network: body.x402Network,
        asset: '0x3600000000000000000000000000000000000000',
        amount: body.x402Authorization.value,
        payTo: body.x402Authorization.to,
        maxTimeoutSeconds: 604900,
        extra: {
          name: 'GatewayWalletBatched',
          version: '1',
          verifyingContract: '0x0077777d7eba4688bdef3e311b846f25870a19b9',
        },
      };
      const headerValue = encodePaymentSignatureHeader({
        x402Version: body.x402Version ?? 2,
        scheme: body.x402Scheme,
        network: body.x402Network,
        resource: {
          url: `/v1/agents/arc/${body.targetAgentId}/attest`,
          description: 'Caliber signed rating attestation',
          mimeType: 'application/json',
        },
        accepted: acceptedRequirement,
        payload: {
          signature,
          authorization: body.x402Authorization,
        },
      } as unknown as Parameters<typeof encodePaymentSignatureHeader>[0]);
      attestHeaders['X-PAYMENT'] = headerValue;
      console.log(
        `[post-job-challenge] x402 Circle PW signature accepted · challenge=${body.x402SignChallengeId.slice(0, 8)}… sig=${signature.slice(0, 12)}…`,
      );
    } else if (body.x402TransactionId || body.x402RefId) {
      // Resolve to a Circle transactionId either directly or via refId
      // lookup. CONTRACT_EXECUTION challenges don't expose the
      // transactionId in the SDK callback, so the refId path is the
      // common one — we tagged the challenge at create-time and look it
      // up here.
      let txId = body.x402TransactionId ?? null;
      let lastFound: Awaited<ReturnType<typeof findTransactionByRefId>> = null;
      if (!txId && body.x402RefId) {
        // Extended to ~30s — Circle's listTransactions can lag by ~15-20s
        // before a freshly-submitted CONTRACT_EXECUTION shows up.
        for (let i = 0; i < 30 && !txId; i++) {
          const found = await findTransactionByRefId(
            body.userToken,
            body.x402RefId,
            body.walletId,
          ).catch(() => null);
          if (found?.id) {
            txId = found.id;
            lastFound = found;
            break;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      if (!txId) {
        return NextResponse.json(
          {
            error: 'x402_transaction_not_found',
            detail: `no Circle tx for refId ${body.x402RefId} after 30s`,
          },
          { status: 504 },
        );
      }
      // Log the match path for diagnostics; visible in arc-web logs.
      console.log(
        `[post-job-challenge] x402 tx resolved via ${lastFound?.matchedBy ?? 'direct id'} · ` +
          `id=${txId} · refId=${body.x402RefId ?? '(none)'} · candidates=${lastFound?.candidates ?? 'n/a'}`,
      );

      // Poll Circle for the on-chain txHash. Circle submits the tx async;
      // the hash appears once it lands. Try ~30s with 1s intervals — Arc
      // is sub-second but Circle's relayer adds round-trip latency.
      let paymentTxHash: string | null = null;
      for (let i = 0; i < 30; i++) {
        const status = await getUserTransactionStatus(body.userToken, txId).catch(
          () => null,
        );
        if (status?.txHash) {
          paymentTxHash = status.txHash;
          break;
        }
        if (status?.state === 'FAILED' || status?.errorReason) {
          return NextResponse.json(
            {
              error: 'x402_payment_failed',
              detail: status?.errorReason ?? 'circle reported FAILED',
            },
            { status: 422 },
          );
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (!paymentTxHash) {
        return NextResponse.json(
          { error: 'x402_payment_timeout', detail: 'Circle tx hash not available after 30s' },
          { status: 504 },
        );
      }
      console.log(
        `[post-job-challenge] x402 payment confirmed · txHash=${paymentTxHash.slice(0, 12)}…`,
      );
      attestHeaders['x-payment-proof'] = paymentTxHash;
    } else if (process.env.X402_BYPASS_TOKEN) {
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
