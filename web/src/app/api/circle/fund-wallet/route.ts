// POST /api/circle/fund-wallet
//
// Body: { address: "0x..." }
// Returns:
//   200 { ok: true, txHash, amount, alreadyFunded }
//   503 { error: 'not_configured', faucetUrl } when TEST_FUNDER_PRIVATE_KEY missing
//   400 { error } on invalid address
//   500 { error } on transfer failure
//
// One-shot judge-demo drip. When a new Circle wallet is created via Google /
// Email OTP, the client fires this endpoint with the freshly-created address.
// Server sends FUND_AMOUNT_USDC of ERC-20 USDC from the TEST_FUNDER wallet so
// the judge can immediately walk the gated-job demo without visiting Circle's
// faucet. Idempotent on address via the funded_wallets table — repeat calls
// return the original txHash instead of double-funding.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createWalletClient, createPublicClient, http, parseUnits, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { db, fundedWallets } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { arcTestnet } from '@/lib/wagmi/chains';
import { USDC_CONTRACT } from '@/lib/contracts/addresses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FUND_AMOUNT_USDC = process.env.TEST_FUND_AMOUNT_USDC ?? '0.5';
const FAUCET_URL = 'https://faucet.circle.com/?token=USDC';

const ERC20_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const bodySchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'invalid address'),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: parsed.error.issues[0]?.message ?? 'invalid' },
      { status: 400 },
    );
  }
  const address = parsed.data.address.toLowerCase();

  // Idempotency check — if this address has been funded before, return the
  // original txHash. Stops repeat clicks / page reloads from draining the
  // funder wallet.
  const existing = await db
    .select()
    .from(fundedWallets)
    .where(eq(fundedWallets.address, address))
    .limit(1);
  if (existing[0]) {
    return NextResponse.json({
      ok: true,
      txHash: existing[0].txHash,
      amount: existing[0].amountUsdc,
      alreadyFunded: true,
    });
  }

  const funderKey = process.env.TEST_FUNDER_PRIVATE_KEY;
  if (!funderKey || funderKey.length < 64) {
    return NextResponse.json(
      {
        error: 'not_configured',
        message:
          'TEST_FUNDER_PRIVATE_KEY not set on the server. Use the Circle faucet instead.',
        faucetUrl: FAUCET_URL,
      },
      { status: 503 },
    );
  }

  try {
    const account = privateKeyToAccount(
      (funderKey.startsWith('0x') ? funderKey : `0x${funderKey}`) as Hex,
    );

    const rpcUrl = process.env.ARC_RPC_URL ?? arcTestnet.rpcUrls.default.http[0];
    const publicClient = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl) });
    const walletClient = createWalletClient({
      account,
      chain: arcTestnet,
      transport: http(rpcUrl),
    });

    const amount = parseUnits(FUND_AMOUNT_USDC, 6);

    const txHash = await walletClient.writeContract({
      address: USDC_CONTRACT as Hex,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [address as Hex, amount],
    });

    // Don't block on full confirmation — Arc has sub-second finality and the
    // client will see the balance bump on its next poll. But do wait one
    // block so the txHash actually lands before we persist it.
    await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });

    await db
      .insert(fundedWallets)
      .values({ address, txHash, amountUsdc: FUND_AMOUNT_USDC })
      .onConflictDoNothing();

    return NextResponse.json({
      ok: true,
      txHash,
      amount: FUND_AMOUNT_USDC,
      alreadyFunded: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json(
      { error: 'transfer_failed', message, faucetUrl: FAUCET_URL },
      { status: 500 },
    );
  }
}
