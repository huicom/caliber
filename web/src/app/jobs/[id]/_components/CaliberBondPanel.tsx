'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useReadContract, useWriteContract, usePublicClient, useChainId } from 'wagmi';
import { ConnectKitButton } from 'connectkit';
import { type Abi } from 'viem';
import { USDC_CONTRACT, CALIBER_ESCROW } from '@/lib/contracts/addresses';
import { arcTestnet } from '@/lib/wagmi/chains';
import USDC_ABI from '@/lib/contracts/abis/USDC.json';
import CaliberEscrow_ABI from '@/lib/contracts/abis/CaliberEscrow.json';

const RATING_API_BASE =
  process.env.NEXT_PUBLIC_RATING_API_BASE ?? 'https://caliber-api.poko.blue';

interface AttestationResponse {
  attestation: {
    chain: string;
    agentId: string;
    agentAddress: string;
    tier: number;
    pdBps: number;
    lgdBps: number;
    confidence: number;
    methodologyVersion: string;
    asOf: string;
    validUntil: string;
    nonce: string;
  };
  signature: string;
  validUntil: number;
  methodologyVersion: string;
}

interface Props {
  jobId: string;
  providerAddress: string;
  providerAgentId: string | null;
  budgetRaw: string | null; // USDC raw (6 decimals) as decimal string
  jobStatus: string;
}

// Bond status: 0 active, 1 released, 2 slashed.
const BOND_LABEL = ['locked', 'released to agent', 'slashed to client'] as const;

export function CaliberBondPanel({
  jobId,
  providerAddress,
  providerAgentId,
  budgetRaw,
  jobStatus,
}: Props) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const wrongChain = isConnected && chainId !== arcTestnet.id;
  const { writeContract: writeApprove, isPending: approvePending } = useWriteContract();
  const { writeContract: writePost, isPending: postPending } = useWriteContract();
  const { writeContract: writeRelease, isPending: releasePending } = useWriteContract();
  const { writeContract: writeSlash, isPending: slashPending } = useWriteContract();

  const isProvider =
    isConnected && address && address.toLowerCase() === providerAddress.toLowerCase();

  // Read current bond state directly from the contract.
  const { data: bond, refetch: refetchBond } = useReadContract({
    address: CALIBER_ESCROW as `0x${string}`,
    abi: CaliberEscrow_ABI as Abi,
    functionName: 'bonds',
    args: [BigInt(jobId)],
  });

  const bondData = bond as [`0x${string}`, `0x${string}`, bigint, number] | undefined;
  const hasBond = bondData && bondData[0] !== '0x0000000000000000000000000000000000000000';
  const bondPoster = bondData?.[0];
  const bondClient = bondData?.[1];
  const bondAmount = bondData?.[2] ?? BigInt(0);
  const bondStatus = bondData?.[3] ?? 0;

  // Pre-flight attestation lookup so we can preview the bond formula.
  const [att, setAtt] = useState<AttestationResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (!providerAgentId || hasBond) {
      setAtt(null);
      return;
    }
    let cancelled = false;
    fetch(`${RATING_API_BASE}/v1/agents/arc/${providerAgentId}/attest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minTier: 'Caliber-D', minConfidence: 'low' }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.signature) {
          setAtt(data);
          setPreviewError(null);
        } else {
          setPreviewError(data.detail ?? data.reason ?? 'rating unavailable');
        }
      })
      .catch(() => {
        if (!cancelled) setPreviewError('rating lookup failed');
      });
    return () => {
      cancelled = true;
    };
  }, [providerAgentId, hasBond]);

  const requiredBondAmount = (() => {
    if (!att || !budgetRaw) return null;
    const budget = BigInt(budgetRaw);
    const pdBps = BigInt(att.attestation.pdBps);
    const lgdBps = BigInt(att.attestation.lgdBps);
    return (budget * pdBps * lgdBps) / BigInt(100_000_000);
  })();

  const [error, setError] = useState<string | null>(null);

  const handlePost = useCallback(() => {
    if (!att || !requiredBondAmount) return;
    setError(null);
    const a = att.attestation;

    // popup #1: approve USDC to escrow
    writeApprove(
      {
        address: USDC_CONTRACT as `0x${string}`,
        abi: USDC_ABI as Abi,
        functionName: 'approve',
        args: [CALIBER_ESCROW, requiredBondAmount],
      },
      {
        onSuccess: () => {
          // popup #2: postBond
          writePost(
            {
              address: CALIBER_ESCROW as `0x${string}`,
              abi: CaliberEscrow_ABI as Abi,
              functionName: 'postBond',
              args: [
                BigInt(jobId),
                {
                  chain: a.chain as `0x${string}`,
                  agentId: BigInt(a.agentId),
                  agentAddress: a.agentAddress as `0x${string}`,
                  tier: a.tier,
                  pdBps: a.pdBps,
                  lgdBps: a.lgdBps,
                  confidence: a.confidence,
                  methodologyVersion: a.methodologyVersion as `0x${string}`,
                  asOf: BigInt(a.asOf),
                  validUntil: BigInt(a.validUntil),
                  nonce: BigInt(a.nonce),
                },
                att.signature as `0x${string}`,
              ],
            },
            {
              onSuccess: async (hash) => {
                if (publicClient) {
                  await publicClient.waitForTransactionReceipt({ hash });
                }
                refetchBond();
              },
              onError: (err) => setError(`Post bond failed: ${err.message}`),
            },
          );
        },
        onError: (err) => setError(`USDC approval failed: ${err.message}`),
      },
    );
  }, [att, requiredBondAmount, jobId, writeApprove, writePost, publicClient, refetchBond]);

  const handleRelease = useCallback(() => {
    setError(null);
    writeRelease(
      {
        address: CALIBER_ESCROW as `0x${string}`,
        abi: CaliberEscrow_ABI as Abi,
        functionName: 'release',
        args: [BigInt(jobId)],
      },
      {
        onSuccess: async (hash) => {
          if (publicClient) await publicClient.waitForTransactionReceipt({ hash });
          refetchBond();
        },
        onError: (err) => setError(`Release failed: ${err.message}`),
      },
    );
  }, [jobId, writeRelease, publicClient, refetchBond]);

  const handleSlash = useCallback(() => {
    setError(null);
    writeSlash(
      {
        address: CALIBER_ESCROW as `0x${string}`,
        abi: CaliberEscrow_ABI as Abi,
        functionName: 'slash',
        args: [BigInt(jobId)],
      },
      {
        onSuccess: async (hash) => {
          if (publicClient) await publicClient.waitForTransactionReceipt({ hash });
          refetchBond();
        },
        onError: (err) => setError(`Slash failed: ${err.message}`),
      },
    );
  }, [jobId, writeSlash, publicClient, refetchBond]);

  // Determine which terminal action (if any) is enabled given the on-chain
  // job status. The contract enforces this — these are just UX hints.
  const canRelease = hasBond && bondStatus === 0 && jobStatus === 'Completed';
  const canSlash =
    hasBond && bondStatus === 0 && (jobStatus === 'Rejected' || jobStatus === 'Expired');

  return (
    <div className="border border-[var(--color-hairline)] bg-white rounded-[2px] p-5 space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-mono text-[13px] text-[var(--color-ink)] tracking-[0.02em]">
          //caliber_bond
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-[var(--color-mute)]">
          bond = budget × pd × lgd
        </span>
      </div>

      {error && (
        <div className="border-l-2 border-[var(--color-signal-down)] bg-white px-3 py-2 text-xs text-[var(--color-signal-down)]">
          {error}
        </div>
      )}

      {/* === Already bonded === */}
      {hasBond && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono bg-[var(--color-bg-elev)] border border-[var(--color-hairline)] p-3 rounded-[2px]">
            <span className="text-[var(--color-mute)]">status</span>
            <span className="text-right text-[var(--color-ink)] font-medium">
              {BOND_LABEL[bondStatus] ?? 'unknown'}
            </span>
            <span className="text-[var(--color-mute)]">amount</span>
            <span className="text-right text-[var(--color-ink)]">
              {(Number(bondAmount) / 1e6).toFixed(4)} USDC
            </span>
            <span className="text-[var(--color-mute)]">posted by</span>
            <span className="text-right text-[var(--color-ink)]">
              {bondPoster?.slice(0, 6)}…{bondPoster?.slice(-4)}
            </span>
            <span className="text-[var(--color-mute)]">slashable to</span>
            <span className="text-right text-[var(--color-ink)]">
              {bondClient?.slice(0, 6)}…{bondClient?.slice(-4)}
            </span>
          </div>

          {bondStatus === 0 && (
            <div className="flex gap-2">
              <button
                onClick={handleRelease}
                disabled={!canRelease || releasePending || !isConnected || wrongChain}
                className="flex-1 py-2 px-3 bg-[var(--color-ink)] text-[var(--color-paper)] text-xs font-medium rounded-[2px] hover:bg-[#1c2028] disabled:opacity-40 disabled:cursor-not-allowed"
                title={canRelease ? 'Job is completed — release bond to the agent' : 'Job must be Completed before bond can be released'}
              >
                {releasePending ? 'releasing…' : 'release (job completed)'}
              </button>
              <button
                onClick={handleSlash}
                disabled={!canSlash || slashPending || !isConnected || wrongChain}
                className="flex-1 py-2 px-3 bg-white border border-[var(--color-signal-down)] text-[var(--color-signal-down)] text-xs font-medium rounded-[2px] hover:bg-[var(--color-bg-elev)] disabled:opacity-40 disabled:cursor-not-allowed"
                title={canSlash ? 'Job was rejected or expired — slash bond to client' : 'Job must be Rejected or Expired before bond can be slashed'}
              >
                {slashPending ? 'slashing…' : 'slash (rejected/expired)'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* === No bond yet — agent's view (call to action) === */}
      {!hasBond && isProvider && (
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-mute)] leading-snug">
            You are the provider. Posting a Caliber bond signals skin in the game — proportional
            to your performance-default risk. Bond returns to you on job completion; goes to the
            client on rejection/expiry.
          </p>

          {previewError && (
            <div className="border-l-2 border-[var(--color-copper)] bg-white px-3 py-2 text-xs text-[var(--color-ink)]">
              Caliber rating unavailable for this agent: {previewError}. You can still complete the
              job, but no bond can be posted.
            </div>
          )}

          {att && requiredBondAmount !== null && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono bg-[var(--color-bg-elev)] border border-[var(--color-hairline)] p-3 rounded-[2px]">
              <span className="text-[var(--color-mute)]">rating</span>
              <span className="text-right text-[var(--color-ink)] font-medium">
                Caliber-{['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC', 'CC', 'D'][att.attestation.tier]}
              </span>
              <span className="text-[var(--color-mute)]">pd × lgd</span>
              <span className="text-right text-[var(--color-ink)]">
                {(att.attestation.pdBps / 100).toFixed(2)}% × {(att.attestation.lgdBps / 100).toFixed(1)}%
              </span>
              <span className="text-[var(--color-mute)]">budget</span>
              <span className="text-right text-[var(--color-ink)]">
                {budgetRaw ? (Number(budgetRaw) / 1e6).toFixed(2) : '—'} USDC
              </span>
              <span className="text-[var(--color-mute)] border-t border-[var(--color-hairline)] pt-1">
                required bond
              </span>
              <span className="text-right text-[var(--color-ink)] font-semibold border-t border-[var(--color-hairline)] pt-1">
                {(Number(requiredBondAmount) / 1e6).toFixed(4)} USDC
              </span>
            </div>
          )}

          {wrongChain && (
            <p className="text-xs text-[var(--color-signal-down)]">
              Switch wallet to Arc Testnet (chain {arcTestnet.id}) to post the bond.
            </p>
          )}

          <button
            onClick={handlePost}
            disabled={!att || !requiredBondAmount || approvePending || postPending || wrongChain}
            className="w-full py-2.5 px-4 bg-[var(--color-ink)] text-[var(--color-paper)] text-sm font-medium rounded-[2px] hover:bg-[#1c2028] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {approvePending
              ? 'confirm approve in wallet…'
              : postPending
                ? 'confirm post in wallet…'
                : att
                  ? 'post bond (2 popups)'
                  : 'awaiting rating…'}
          </button>
        </div>
      )}

      {/* === No bond, viewer is not the agent === */}
      {!hasBond && !isProvider && (
        <p className="text-sm text-[var(--color-mute)] leading-snug">
          No Caliber bond has been posted on this job. The provider can post one to signal skin in
          the game; it would be slashed to the client on rejection/expiry.
          {!isConnected && (
            <span className="block mt-2">
              <ConnectKitButton />
            </span>
          )}
        </p>
      )}
    </div>
  );
}
