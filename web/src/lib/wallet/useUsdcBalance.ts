'use client';

import { useEffect, useState } from 'react';
import { createPublicClient, http, parseAbi, formatUnits } from 'viem';
import { arcTestnet } from '@/lib/wagmi/chains';
import { USDC_CONTRACT } from '@/lib/contracts/addresses';

/* ──────────────────────────────────────────────────────────────────────────
 * useUsdcBalance — live USDC balance for any address on Arc Testnet.
 *
 * Used by ConnectButton so the brand chip + dropdown show the current
 * balance (not the historical "funded" amount, which is misleading after
 * the user spends USDC on a job post). Re-fetches every 10 s + on demand
 * via the returned refresh() callback. Cheap: one eth_call per poll, no
 * indexer dependency.
 * ────────────────────────────────────────────────────────────────────────── */

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
]);

const RPC_URL =
  process.env.NEXT_PUBLIC_ARC_RPC_URL ?? arcTestnet.rpcUrls.default.http[0];

let _client: ReturnType<typeof createPublicClient> | null = null;
function getClient() {
  if (!_client) {
    _client = createPublicClient({ chain: arcTestnet, transport: http(RPC_URL) });
  }
  return _client;
}

export interface UseUsdcBalanceResult {
  /** Decimal-formatted balance with 6-decimals precision, e.g. "1.495". */
  balance: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useUsdcBalance(
  address: `0x${string}` | undefined | null,
  options: { pollIntervalMs?: number } = {},
): UseUsdcBalanceResult {
  const pollInterval = options.pollIntervalMs ?? 10_000;
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!address) {
      setBalance(null);
      setError(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const fetchOnce = async () => {
      if (cancelled) return;
      setLoading(true);
      try {
        const raw = (await getClient().readContract({
          address: USDC_CONTRACT as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        })) as bigint;
        if (cancelled) return;
        setBalance(formatUnits(raw, 6));
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'balance fetch failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchOnce();
    if (pollInterval > 0) {
      timer = setInterval(() => void fetchOnce(), pollInterval);
    }
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [address, pollInterval, tick]);

  const refresh = () => setTick((n) => n + 1);

  return { balance, loading, error, refresh };
}
