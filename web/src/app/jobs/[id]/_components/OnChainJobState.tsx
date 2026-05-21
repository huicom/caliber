'use client';

import { useJob } from '@/hooks/useJob';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatUSDC } from '@/lib/format';
import { useAccount } from 'wagmi';

export function OnChainJobState({ jobId }: { jobId: string }) {
  const { isConnected } = useAccount();
  const id = BigInt(jobId);
  const { job, isLoading } = useJob(id);

  if (!isConnected) {
    return (
      <Card className="border-dashed border-accent/40">
        <CardHeader>
          <CardTitle className="text-sm text-text-muted">
            On-Chain State
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-text-dim">
            Connect wallet to read live chain state
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className="border-dashed border-accent/40">
        <CardHeader>
          <CardTitle className="text-sm text-text-muted">
            On-Chain State
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 animate-pulse">
            <div className="h-3 bg-bg-elev rounded w-2/3" />
            <div className="h-3 bg-bg-elev rounded w-1/2" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!job) {
    return (
      <Card className="border-dashed border-danger/40">
        <CardHeader>
          <CardTitle className="text-sm text-text-muted">
            On-Chain State
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-danger">
            Job not found on-chain
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-dashed border-accent/40">
      <CardHeader>
        <CardTitle className="text-sm text-accent">
          On-Chain State
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-text-dim">Status</span>
            <span className="font-medium">{job.statusLabel}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-dim">Budget</span>
            <span className="font-medium">
              {job.budget > BigInt(0)
                ? `$${formatUSDC(job.budget.toString(), 2)} USDC`
                : 'Not set'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-dim">Client</span>
            <span className="font-mono text-xs">
              {job.client.slice(0, 10)}...
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-dim">Provider</span>
            <span className="font-mono text-xs">
              {job.provider.slice(0, 10)}...
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-dim">Evaluator</span>
            <span className="font-mono text-xs">
              {job.evaluator.slice(0, 10)}...
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-dim">Hook</span>
            <span className="font-mono text-xs">
              {job.hook === '0x0000000000000000000000000000000000000000'
                ? 'None'
                : `${job.hook.slice(0, 10)}...`}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
