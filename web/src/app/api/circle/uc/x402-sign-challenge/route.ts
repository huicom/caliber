// POST /api/circle/uc/x402-sign-challenge
//
// Body: { userToken, walletId, walletAddress }
// Returns: { challengeId, authorization, network, scheme, x402Version, asset, payTo }
//
// Step 1 of the visible Circle Programmable Wallet x402 flow:
//   1. Probe the rating API to read Circle Gateway's 402 payment hint
//      (recipient, amount, verifyingContract).
//   2. Build an EIP-3009 TransferWithAuthorization typed-data payload
//      against the GatewayWalletBatched domain.
//   3. Create a Circle signTypedData challenge with the JSON-stringified
//      typed-data so the user can sign it in their PIN modal.
//
// Step 2 (browser runs sdk.execute, returns signature) → step 3
// (post-job-challenge submits the signature as X-PAYMENT to the rating API).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import { GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS } from '@circle-fin/x402-batching';
import { createSignTypedDataChallenge } from '@/lib/circle/user-controlled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RATING_API_BASE =
  process.env.NEXT_PUBLIC_RATING_API_BASE ?? 'https://caliber-api.poko.blue';

const bodySchema = z.object({
  userToken: z.string().min(1),
  walletId: z.string().min(1),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  agentId: z.string().regex(/^\d+$/).optional().default('1'),
});

interface Hint {
  scheme: string;
  network: string; // CAIP-2 e.g. "eip155:5042002"
  asset: string;
  amount: string;
  payTo: string;
  extra?: {
    name?: string;
    version?: string;
    verifyingContract?: string;
  };
}

interface PaymentRequired {
  x402Version: number;
  accepts: Hint[];
}

function randomNonce(): `0x${string}` {
  // 32-byte random hex.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;
}

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const { userToken, walletId, walletAddress, agentId } = parsed.data;

  try {
    // 1. Provoke 402 from rating API (no bypass, no payment).
    const probe = await fetch(`${RATING_API_BASE}/v1/agents/arc/${agentId}/attest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minTier: 'Dormant' }),
    });
    if (probe.status !== 402) {
      const detail = await probe.text().catch(() => '');
      return NextResponse.json(
        { error: 'unexpected_probe_status', status: probe.status, detail: detail.slice(0, 400) },
        { status: 502 },
      );
    }
    const headerValueRaw = probe.headers.get('payment-required');
    if (!headerValueRaw) {
      return NextResponse.json({ error: 'missing_402_header' }, { status: 502 });
    }
    const pr = decodePaymentRequiredHeader(headerValueRaw) as unknown as PaymentRequired;
    const requirement = pr.accepts?.[0];
    if (!requirement || !requirement.extra?.verifyingContract) {
      return NextResponse.json({ error: 'malformed_402_hint', pr }, { status: 502 });
    }

    // 2. Build EIP-3009 TransferWithAuthorization typed-data against the
    //    GatewayWalletBatched domain. Circle Gateway facilitator has two
    //    constraints we have to satisfy simultaneously:
    //      - validBefore - validAfter <= maxTimeoutSeconds (604900s here)
    //      - validBefore - now_at_verify >= minValiditySeconds (604800s)
    //    Latency budget = 100s. We maximise window length so the user has
    //    time to walk through x402 sign + approve + post before our
    //    server submits X-PAYMENT. validAfter is set to NOW (no past
    //    buffer) so the full 100s budget is available for latency.
    const chainId = Number(requirement.network.split(':')[1]);
    const now = Math.floor(Date.now() / 1000);
    const maxTimeout = (requirement.extra as { maxTimeoutSeconds?: number })?.maxTimeoutSeconds
      ?? (requirement as unknown as { maxTimeoutSeconds?: number }).maxTimeoutSeconds
      ?? 604900;
    // Subtract 1 second so we're definitively under the cap.
    const validBefore = now + maxTimeout - 1;
    const nonce = randomNonce();

    const authorization = {
      from: walletAddress,
      to: requirement.payTo,
      value: requirement.amount,
      validAfter: String(now),
      validBefore: String(validBefore),
      nonce,
    };
    void GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS; // legacy import retained for reference

    const typedData = {
      domain: {
        name: requirement.extra.name ?? 'GatewayWalletBatched',
        version: requirement.extra.version ?? '1',
        chainId,
        verifyingContract: requirement.extra.verifyingContract,
      },
      // Circle's signTypedData validator requires EIP712Domain to be listed
      // explicitly in `types`, matching the 4-field domain object above.
      // viem-style signers add this automatically; Circle's flow does not.
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      message: authorization,
    };

    // 3. Create Circle signTypedData challenge — user signs in PIN modal.
    const { challengeId } = await createSignTypedDataChallenge({
      userToken,
      walletId,
      typedData: JSON.stringify(typedData),
      memo: `Caliber x402 · ${requirement.amount} ${requirement.asset.slice(0, 10)}…`,
    });

    return NextResponse.json({
      challengeId,
      authorization,
      network: requirement.network,
      scheme: requirement.scheme,
      x402Version: pr.x402Version,
      asset: requirement.asset,
      payTo: requirement.payTo,
      amount: requirement.amount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: 'x402_sign_challenge_failed', message }, { status: 500 });
  }
}
