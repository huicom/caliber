// GET /api/circle/uc/gateway-balance?address=0x...
//
// Returns: { address, gatewayBalance, gatewayBalanceFormatted }
//
// Pre-flight check for the x402 sign flow. If gatewayBalance < attestation
// price, the UI prompts the user to deposit first. Reads directly from the
// GatewayWallet contract on Arc Testnet — no Circle API auth needed.

import { NextResponse } from 'next/server';
import { createPublicClient, http, formatUnits } from 'viem';
import { USDC_CONTRACT } from '@/lib/contracts/addresses';
import {
  TESTNET_GATEWAY_WALLET,
  GATEWAY_WALLET_ABI,
} from '@/lib/circle/user-controlled';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RPC_URL = process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const address = url.searchParams.get('address')?.toLowerCase();
  if (!address || !/^0x[a-f0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: 'bad_address' }, { status: 400 });
  }
  try {
    const client = createPublicClient({ transport: http(RPC_URL) });
    const balance = (await client.readContract({
      address: TESTNET_GATEWAY_WALLET,
      abi: GATEWAY_WALLET_ABI,
      functionName: 'availableBalance',
      args: [USDC_CONTRACT as `0x${string}`, address as `0x${string}`],
    })) as bigint;
    return NextResponse.json({
      address,
      gatewayBalance: balance.toString(),
      gatewayBalanceFormatted: formatUnits(balance, 6),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: 'balance_query_failed', message }, { status: 500 });
  }
}
