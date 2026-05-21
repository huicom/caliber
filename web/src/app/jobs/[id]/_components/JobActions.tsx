'use client';

import { useAccount, useWriteContract, useChainId, useReadContract } from 'wagmi';
import { AGENTIC_COMMERCE, RATING_GATEWAY } from '@/lib/contracts/addresses';
import { arcTestnet } from '@/lib/wagmi/chains';
import ERC8183_ABI from '@/lib/contracts/abis/ERC8183.json';
import RatingGateway_ABI from '@/lib/contracts/abis/RatingGateway.json';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatUSDC } from '@/lib/format';
import { useJob, type OnChainJob } from '@/hooks/useJob';
import { type Abi, keccak256, toHex, stringToHex } from 'viem';
import { useState } from 'react';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
import {
  Briefcase,
  CheckCircle,
  Send,
  ShieldCheck,
  XCircle,
  RotateCcw,
  AlertTriangle,
  Wallet,
  ExternalLink,
} from 'lucide-react';
import { arcscanTxUrl } from '@/lib/format';

type ViewerRole = 'client' | 'provider' | 'evaluator' | 'none';

const ROLE_LABELS: Record<string, string> = {
  client: 'Client (Poster)',
  provider: 'Provider (Agent)',
  evaluator: 'Evaluator',
};

// When a job was posted through RatingGateway, the on-chain `job.client` is
// the gateway contract — not the user. The real poster lives in
// `gateway.jobPoster[jobId]`. For "Fund Job" / refund decisions we need to
// treat that poster as the client, not the gateway.
function getRole(
  job: OnChainJob | null,
  connectedAddress: string | undefined,
  gatewayPoster: string | undefined,
): ViewerRole {
  if (!job || !connectedAddress) return 'none';
  const addr = connectedAddress.toLowerCase();
  const effectiveClient =
    gatewayPoster && gatewayPoster.toLowerCase() !== ZERO_ADDRESS
      ? gatewayPoster.toLowerCase()
      : job.client.toLowerCase();
  if (effectiveClient === addr) return 'client';
  if (job.provider.toLowerCase() === addr) return 'provider';
  if (job.evaluator.toLowerCase() === addr) return 'evaluator';
  return 'none';
}

const TX_REASONS: Record<string, string> = {
  '0x00000000000000000000000000000000000000000000000000000000636f6d706c657465': 'Job completed successfully',
};

function padBytes32(hex: string): `0x${string}` {
  if (hex.startsWith('0x') && hex.length === 66) return hex as `0x${string}`;
  if (hex.startsWith('0x')) return (hex + '0'.repeat(66 - hex.length)).slice(0, 66) as `0x${string}`;
  return `0x${hex.padEnd(64, '0')}` as `0x${string}`;
}

function reasonToBytes32(reason: string): `0x${string}` {
  try {
    const hex = stringToHex(reason);
    return keccak256(toHex(reason));
  } catch {
    return keccak256(toHex(reason));
  }
}

export function JobActions({ jobId }: { jobId: string }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const wrongChain = isConnected && chainId !== arcTestnet.id;
  const id = BigInt(jobId);
  const { job, isLoading } = useJob(id);
  const { writeContract, isPending } = useWriteContract();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [deliverableText, setDeliverableText] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [completeReason, setCompleteReason] = useState('');
  const [budgetInput, setBudgetInput] = useState('');

  // Look up the real poster behind this jobId. Returns address(0) for jobs
  // that didn't go through RatingGateway — we fall back to job.client then.
  const { data: gatewayPoster } = useReadContract({
    address: RATING_GATEWAY as `0x${string}`,
    abi: RatingGateway_ABI as Abi,
    functionName: 'jobPoster',
    args: [id],
    query: { enabled: !!job },
  });

  const role = getRole(job, address, gatewayPoster as string | undefined);
  const status = job?.status ?? -1;
  const budgetSet = !!job && job.budget > BigInt(0);

  if (wrongChain) {
    return (
      <Card className="border-danger/30">
        <CardHeader>
          <CardTitle className="text-sm text-danger flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Wrong Network
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-text-dim">
            Please switch your wallet to Arc Testnet (Chain ID: {arcTestnet.id}) to interact with this job.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!isConnected) {
    return (
      <Card className="border-dashed border-accent/30">
        <CardHeader>
          <CardTitle className="text-sm text-text-muted flex items-center gap-2">
            <Wallet className="w-4 h-4" />
            Job Actions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-text-dim">
            Connect wallet to see available actions for your role.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className="border-dashed border-accent/30">
        <CardHeader>
          <CardTitle className="text-sm text-text-muted">Job Actions</CardTitle>
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

  if (role === 'none' || !job) {
    return null;
  }

  const handleSubmit = () => {
    const deliverableHash = deliverableText.trim()
      ? keccak256(toHex(deliverableText.trim()))
      : padBytes32(stringToHex('submitted'));
    setPendingAction('submit');
    writeContract(
      {
        address: AGENTIC_COMMERCE as `0x${string}`,
        abi: ERC8183_ABI.abi as Abi,
        functionName: 'submit',
        args: [id, deliverableHash, '0x'],
      },
      {
        onSuccess: () => { setPendingAction(null); setDeliverableText(''); },
        onError: () => setPendingAction(null),
      },
    );
  };

  const handleFund = () => {
    setPendingAction('fund');
    writeContract(
      {
        address: RATING_GATEWAY as `0x${string}`,
        abi: RatingGateway_ABI as Abi,
        functionName: 'fundJob',
        args: [id],
      },
      {
        onSuccess: () => setPendingAction(null),
        onError: () => setPendingAction(null),
      },
    );
  };

  const handleSetBudget = () => {
    const amount = parseFloat(budgetInput);
    if (isNaN(amount) || amount <= 0) return;
    const amountWei = BigInt(Math.floor(amount * 1_000_000));
    setPendingAction('setBudget');
    writeContract(
      {
        address: AGENTIC_COMMERCE as `0x${string}`,
        abi: ERC8183_ABI.abi as Abi,
        functionName: 'setBudget',
        args: [id, amountWei, '0x'],
      },
      {
        onSuccess: () => { setPendingAction(null); setBudgetInput(''); },
        onError: () => setPendingAction(null),
      },
    );
  };

  const handleComplete = () => {
    const reasonHash = completeReason.trim()
      ? reasonToBytes32(completeReason.trim())
      : reasonToBytes32('approved');
    setPendingAction('complete');
    writeContract(
      {
        address: AGENTIC_COMMERCE as `0x${string}`,
        abi: ERC8183_ABI.abi as Abi,
        functionName: 'complete',
        args: [id, reasonHash, '0x'],
      },
      {
        onSuccess: () => { setPendingAction(null); setCompleteReason(''); },
        onError: () => setPendingAction(null),
      },
    );
  };

  const handleReject = () => {
    const reasonHash = rejectReason.trim()
      ? reasonToBytes32(rejectReason.trim())
      : reasonToBytes32('rejected');
    setPendingAction('reject');
    writeContract(
      {
        address: AGENTIC_COMMERCE as `0x${string}`,
        abi: ERC8183_ABI.abi as Abi,
        functionName: 'reject',
        args: [id, reasonHash, '0x'],
      },
      {
        onSuccess: () => { setPendingAction(null); setRejectReason(''); },
        onError: () => setPendingAction(null),
      },
    );
  };

  const handleClaimRefund = () => {
    setPendingAction('claimRefund');
    writeContract(
      {
        address: AGENTIC_COMMERCE as `0x${string}`,
        abi: ERC8183_ABI.abi as Abi,
        functionName: 'claimRefund',
        args: [id],
      },
      {
        onSuccess: () => setPendingAction(null),
        onError: () => setPendingAction(null),
      },
    );
  };

  return (
    <Card className="border-accent/30">
      <CardHeader>
        <CardTitle className="text-sm text-accent flex items-center gap-2">
          <Briefcase className="w-4 h-4" />
          Actions — {ROLE_LABELS[role]}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-xs text-text-dim">
          <span>Job Status</span>
          <span className="font-medium text-text">{job.statusLabel}</span>
        </div>
        {job.budget > BigInt(0) && (
          <div className="flex items-center justify-between text-xs text-text-dim">
            <span>Budget</span>
            <span className="font-medium text-text">
              ${formatUSDC(job.budget.toString(), 2)} USDC
            </span>
          </div>
        )}

        <div className="border-t border-border pt-3 space-y-3">
          {/* Provider: Submit deliverable (Funded → Submitted) */}
          {role === 'provider' && status === 1 && (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-text-muted">
                Deliverable description (optional — hashed on-chain)
              </label>
              <Input
                placeholder="e.g., https://drive.google.com/file/d/..."
                value={deliverableText}
                onChange={(e) => setDeliverableText(e.target.value)}
                className="text-sm"
              />
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={isPending && pendingAction === 'submit'}
                className="w-full"
              >
                <Send className="w-4 h-4 mr-1" />
                {isPending && pendingAction === 'submit'
                  ? 'Confirm in Wallet...'
                  : 'Submit Deliverable'}
              </Button>
            </div>
          )}

          {/* Client / poster on Open job:
              - budget == 0: provider hasn't accepted yet — show waiting message
              - budget  > 0: Fund Job button (calls RatingGateway.fundJob) */}
          {role === 'client' && status === 0 && !budgetSet && (
            <div className="p-3 rounded bg-bg-subtle text-xs text-text-dim border border-border">
              <AlertTriangle className="w-4 h-4 text-[#FFB547] inline mr-1" />
              Waiting for the provider to call <code>setBudget</code>. Once they accept a budget, you'll see a <strong>Fund Job</strong> button here.
            </div>
          )}
          {role === 'client' && status === 0 && budgetSet && (
            <div className="space-y-2">
              <div className="p-2 rounded bg-success/10 border border-success/30 text-xs">
                Provider has accepted a budget of ${formatUSDC(job.budget.toString(), 2)} USDC. Fund the job to release it into escrow.
              </div>
              <Button
                size="sm"
                onClick={handleFund}
                disabled={isPending && pendingAction === 'fund'}
                className="w-full"
              >
                <ShieldCheck className="w-4 h-4 mr-1" />
                {isPending && pendingAction === 'fund'
                  ? 'Confirm in Wallet...'
                  : 'Fund Job (popup #3)'}
              </Button>
            </div>
          )}

          {/* Provider on Open job:
              - budget == 0: agent must call setBudget on AgenticCommerce
              - budget  > 0: waiting for client to fund */}
          {role === 'provider' && status === 0 && !budgetSet && (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-text-muted">
                Accept this job by setting your budget (USDC). The client pre-funded the gateway for this amount.
              </label>
              <Input
                type="number"
                placeholder="e.g., 100"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                min="1"
                step="0.01"
                className="text-sm"
              />
              <Button
                size="sm"
                onClick={handleSetBudget}
                disabled={(isPending && pendingAction === 'setBudget') || !budgetInput}
                className="w-full"
              >
                {isPending && pendingAction === 'setBudget'
                  ? 'Confirm in Wallet...'
                  : 'Set Budget'}
              </Button>
              <p className="text-xs text-text-dim">
                Must match the amount the client pre-funded (visible in their post-job receipt).
              </p>
            </div>
          )}
          {role === 'provider' && status === 0 && budgetSet && (
            <p className="text-xs text-text-dim italic">
              Budget set. Waiting for the client to call <strong>Fund Job</strong> — once funded, you can submit your deliverable here.
            </p>
          )}

          {/* Evaluator: Approve or reject (Submitted → Completed/Rejected) */}
          {role === 'evaluator' && status === 2 && (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-text-muted">
                Approval note (optional)
              </label>
              <Input
                placeholder="Reason for approval..."
                value={completeReason}
                onChange={(e) => setCompleteReason(e.target.value)}
                className="text-sm"
              />
              <Button
                size="sm"
                onClick={handleComplete}
                disabled={isPending && pendingAction === 'complete'}
                className="w-full bg-success/90 hover:bg-success text-white"
              >
                <ShieldCheck className="w-4 h-4 mr-1" />
                {isPending && pendingAction === 'complete'
                  ? 'Confirm in Wallet...'
                  : 'Approve & Release Payment'}
              </Button>
              <div className="mt-1">
                <label className="block text-xs font-medium text-text-muted">
                  Rejection reason (required)
                </label>
                <Input
                  placeholder="Reason for rejection..."
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="text-sm mb-2"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleReject}
                  disabled={isPending && pendingAction === 'reject' || !rejectReason.trim()}
                  className="w-full"
                >
                  <XCircle className="w-4 h-4 mr-1" />
                  {isPending && pendingAction === 'reject'
                    ? 'Confirm in Wallet...'
                    : 'Reject Job'}
                </Button>
              </div>
            </div>
          )}

          {/* Client can also reject a submitted job */}
          {role === 'client' && status === 2 && (
            <div className="space-y-2">
              <div className="p-2 rounded bg-bg-subtle text-xs text-text-dim">
                <AlertTriangle className="w-4 h-4 text-[#FFB547] inline mr-1" />
                Job has been submitted by the provider. Evaluator should approve or reject.
              </div>
            </div>
          )}

          {/* Terminal states */}
          {status === 3 && (
            <div className="flex items-center gap-2 p-2 rounded bg-success/10 border border-success/30">
              <CheckCircle className="w-4 h-4 text-success shrink-0" />
              <span className="text-xs text-success">Job completed — payment released to provider.</span>
            </div>
          )}

          {status === 4 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-2 rounded bg-danger/10 border border-danger/30">
                <XCircle className="w-4 h-4 text-danger shrink-0" />
                <span className="text-xs text-danger">Job rejected.</span>
              </div>
              {/* Client can claim refund after rejection */}
              {role === 'client' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleClaimRefund}
                  disabled={isPending && pendingAction === 'claimRefund'}
                  className="w-full"
                >
                  <RotateCcw className="w-4 h-4 mr-1" />
                  {isPending && pendingAction === 'claimRefund'
                    ? 'Confirm in Wallet...'
                    : 'Claim Refund'}
                </Button>
              )}
            </div>
          )}

          {status === 5 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-2 rounded bg-bg-subtle">
                <AlertTriangle className="w-4 h-4 text-text-dim shrink-0" />
                <span className="text-xs text-text-dim">Job expired.</span>
              </div>
              {role === 'client' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleClaimRefund}
                  disabled={isPending && pendingAction === 'claimRefund'}
                  className="w-full"
                >
                  <RotateCcw className="w-4 h-4 mr-1" />
                  {isPending && pendingAction === 'claimRefund'
                    ? 'Confirm in Wallet...'
                    : 'Claim Refund'}
                </Button>
              )}
            </div>
          )}

          {/* Evaluator waiting for provider to submit */}
          {role === 'evaluator' && status === 1 && (
            <p className="text-xs text-text-dim italic">
              Waiting for provider to submit deliverable.
            </p>
          )}
        </div>

        <div className="border-t border-border pt-2">
          <a
            href={`https://testnet.arcscan.app/address/${AGENTIC_COMMERCE}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-text-dim hover:text-accent transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            View on Arcscan
          </a>
        </div>
      </CardContent>
    </Card>
  );
}