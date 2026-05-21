'use client';

import { useEffect, useState } from 'react';
import { usePublicClient } from 'wagmi';
import { AGENTIC_COMMERCE } from '@/lib/contracts/addresses';
import { parseAbiItem } from 'viem';

const jobCreatedEvent = parseAbiItem(
  'event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)',
);

export interface UserJobSummary {
  jobId: bigint;
  client: string;
  provider: string;
  blockNumber: bigint;
}

export function useUserJobs(address: string | undefined) {
  const publicClient = usePublicClient();
  const [jobs, setJobs] = useState<UserJobSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!address || !publicClient) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const fetchLogs = async () => {
      try {
        const [asClient, asProvider] = await Promise.all([
          publicClient.getLogs({
            address: AGENTIC_COMMERCE,
            event: jobCreatedEvent,
            args: { client: address as `0x${string}` },
            fromBlock: BigInt(0),
            toBlock: 'latest',
          }),
          publicClient.getLogs({
            address: AGENTIC_COMMERCE,
            event: jobCreatedEvent,
            args: { provider: address as `0x${string}` },
            fromBlock: BigInt(0),
            toBlock: 'latest',
          }),
        ]);

        const allLogs = [...asClient, ...asProvider].sort((a, b) => {
          const aBn = a.blockNumber ?? BigInt(0);
          const bBn = b.blockNumber ?? BigInt(0);
          return Number(aBn - bBn);
        });

        if (!cancelled) {
          setJobs(
            allLogs.map((log) => {
              return {
                jobId: log.args.jobId ?? BigInt(0),
                client: (log.args.client ?? '').toLowerCase(),
                provider: (log.args.provider ?? '').toLowerCase(),
                blockNumber: log.blockNumber ?? BigInt(0),
              };
            }),
          );
        }
      } catch (e) {
        if (!cancelled) setError(e as Error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchLogs();
    return () => {
      cancelled = true;
    };
  }, [address, publicClient]);

  return { jobs, isLoading, error };
}
