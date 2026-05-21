import { useReadContract } from 'wagmi';
import { AGENTIC_COMMERCE } from '@/lib/contracts/addresses';
import ERC8183_ABI from '@/lib/contracts/abis/ERC8183.json';
import { type Abi } from 'viem';

const abi = ERC8183_ABI.abi as Abi;
const STATUS_LABELS: Record<number, string> = {
  0: 'Open',
  1: 'Funded',
  2: 'Submitted',
  3: 'Completed',
  4: 'Rejected',
  5: 'Expired',
};

export interface OnChainJob {
  id: bigint;
  client: string;
  provider: string;
  evaluator: string;
  description: string;
  budget: bigint;
  expiredAt: bigint;
  status: number;
  statusLabel: string;
  hook: string;
}

export function useJob(jobId: bigint | undefined) {
  const { data, isLoading, error } = useReadContract({
    address: AGENTIC_COMMERCE,
    abi,
    functionName: 'getJob',
    args: jobId !== undefined ? [jobId] : undefined,
    query: { enabled: jobId !== undefined },
  });

  if (!data) return { job: null, isLoading, error };

  // getJob returns a single Job struct (tuple), so viem decodes it as an
  // object with the named fields, NOT a 9-element array. Indexing as [0]…[8]
  // returns undefined and crashes downstream calls like job.budget.toString().
  const j = data as unknown as {
    id: bigint;
    client: string;
    provider: string;
    evaluator: string;
    description: string;
    budget: bigint;
    expiredAt: bigint;
    status: number;
    hook: string;
  };

  return {
    job: {
      id: j.id,
      client: j.client,
      provider: j.provider,
      evaluator: j.evaluator,
      description: j.description,
      budget: j.budget,
      expiredAt: j.expiredAt,
      status: j.status,
      statusLabel: STATUS_LABELS[j.status] ?? `Unknown(${j.status})`,
      hook: j.hook,
    } as OnChainJob,
    isLoading,
    error,
  };
}
