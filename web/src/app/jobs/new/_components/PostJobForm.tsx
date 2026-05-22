'use client';

import { useState, useCallback, useEffect } from 'react';
import { useAccount, useWriteContract, useChainId, usePublicClient } from 'wagmi';
import { useSearchParams, useRouter } from 'next/navigation';
import { ConnectKitButton } from 'connectkit';
import {
  USDC_CONTRACT,
  RATING_GATEWAY,
} from '@/lib/contracts/addresses';
import { arcTestnet } from '@/lib/wagmi/chains';
import USDC_ABI from '@/lib/contracts/abis/USDC.json';
import RatingGateway_ABI from '@/lib/contracts/abis/RatingGateway.json';
import { type Abi, decodeEventLog } from 'viem';
import { api, type CaliberTier } from '@/lib/api';

/* ──────────────────────────────────────────────────────────────────────────
 * Caliber-gated job-posting form. Three-popup flow:
 *   1. POST /api/jobs/draft  → keccak256 draftHash (off-chain)
 *   2. POST api.caliber.poko.blue/.../attest → signed RatingAttestation
 *   3. USDC.approve(gateway, budget)         (MetaMask popup #1)
 *   4. gateway.postGatedJob(...)              (MetaMask popup #2)
 *   5. agent calls setBudget directly on AgenticCommerce  (offline)
 *   6. gateway.fundJob(jobId)                 (MetaMask popup #3, on /jobs/[id])
 * Each error path is surfaced explicitly so the user sees a real message.
 * ────────────────────────────────────────────────────────────────────────── */

// Caliber Rating v2.0 — poster selects the WEAKEST acceptable tier.
// Bondable tiers only (Watch + Inactive are auto-refused by the escrow
// and the gateway tier check; no point listing them as a choice).
const TIER_OPTIONS = [
  { value: 0, label: 'Established (only the top tier)' },
  { value: 1, label: 'Proven or better' },
  { value: 2, label: 'Emerging or better' },
  { value: 3, label: 'Provisional or better (loosest)' },
];

const CONFIDENCE_OPTIONS = [
  { value: 0, label: 'High (≥75 completed jobs)' },
  { value: 1, label: 'Moderate (≥25 completed)' },
  { value: 2, label: 'Low (≥5 completed, warned)' },
];

const TIER_NAME_MAP: Record<number, string> = {
  0: 'Established',
  1: 'Proven',
  2: 'Emerging',
  3: 'Provisional',
  4: 'Watch',
  5: 'Inactive',
};

// Lower ordinal = stronger tier. minTier ordinal 3 (Provisional) allows
// agents at ordinal 0..3 and refuses 4..5. Mirrors the contract enum.
const TIER_TO_ORDINAL: Record<CaliberTier, number> = {
  Established: 0,
  Proven: 1,
  Emerging: 2,
  Provisional: 3,
  Watch: 4,
  Inactive: 5,
};

const CONFIDENCE_NAMES = ['high', 'moderate', 'low'] as const;

type TargetCheck =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'rated'; tier: CaliberTier; score: number; confidence: string; meetsTier: boolean }
  | { status: 'unrated'; reason: string }
  | { status: 'error' };

type Step = 'form' | 'attesting' | 'approving' | 'posting' | 'success' | 'error';

interface AttestationResponse {
  attestation: {
    chain: string;
    agentId: string;
    agentAddress: string;
    tier: number;             // 0=Established, 5=Inactive
    score: number;            // 0-100
    interactionCount: number;
    flags: number;            // bitfield
    methodologyVersion: string;
    asOf: string;
    validUntil: string;
    nonce: string;
  };
  signature: string;
  validUntil: number;
  methodologyVersion: string;
  tier: CaliberTier;
  score: number;
  confidence: string;
  flags: string[];
}

const RATING_API_BASE =
  process.env.NEXT_PUBLIC_RATING_API_BASE ?? 'https://caliber-api.poko.blue';

export function PostJobForm() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const wrongChain = isConnected && chainId !== arcTestnet.id;
  const { writeContract: writeUsdcApprove, isPending: approvePending } = useWriteContract();
  const { writeContract: writeGateway, isPending: postPending } = useWriteContract();
  const publicClient = usePublicClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [budget, setBudget] = useState('');
  const [minTier, setMinTier] = useState(3);
  const [minConfidence, setMinConfidence] = useState(1);
  const [deadline, setDeadline] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 16);
  });
  const [targetAgentId, setTargetAgentId] = useState('');
  const [evaluatorAddress, setEvaluatorAddress] = useState('');

  // Pre-fill agent from ?agent=arc:<id> query (set by /agents "Hire" link).
  useEffect(() => {
    const agentParam = searchParams.get('agent');
    if (agentParam) {
      const idx = agentParam.indexOf(':');
      setTargetAgentId(idx >= 0 ? agentParam.slice(idx + 1) : agentParam);
    }
  }, [searchParams]);

  // Default evaluator to the poster's wallet — most common case is self-eval.
  useEffect(() => {
    if (address && !evaluatorAddress) {
      setEvaluatorAddress(address);
    }
  }, [address, evaluatorAddress]);

  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);
  const [attestationData, setAttestationData] = useState<AttestationResponse | null>(null);
  const [draftHash, setDraftHash] = useState<string | null>(null);
  const [createdJobId, setCreatedJobId] = useState<string | null>(null);
  const [targetCheck, setTargetCheck] = useState<TargetCheck>({ status: 'idle' });

  // Pre-flight tier-gap check: as soon as the user picks an agent + tier,
  // hit /v1/ratings/bulk to surface "agent is Caliber-BB, requires Caliber-A"
  // before they spend gas on an attestation that will refuse.
  useEffect(() => {
    if (!targetAgentId || !/^\d+$/.test(targetAgentId)) {
      setTargetCheck({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setTargetCheck({ status: 'loading' });
    const t = setTimeout(async () => {
      try {
        const data = await api.bulkRatings('arc', [targetAgentId]);
        if (cancelled) return;
        const r = data.ratings[0];
        if (!r) {
          setTargetCheck({ status: 'error' });
          return;
        }
        if (!r.rated || !r.tier) {
          setTargetCheck({ status: 'unrated', reason: r.reason ?? 'unrated' });
          return;
        }
        const ord = TIER_TO_ORDINAL[r.tier];
        setTargetCheck({
          status: 'rated',
          tier: r.tier,
          score: r.score ?? 0,
          confidence: r.confidence ?? 'low',
          meetsTier: ord <= minTier,
        });
      } catch {
        if (!cancelled) setTargetCheck({ status: 'error' });
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [targetAgentId, minTier]);

  const tierGapBlocked = targetCheck.status === 'rated' && !targetCheck.meetsTier;
  const submitDisabled =
    !title || !description || !budget || !targetAgentId || !evaluatorAddress || !isConnected || wrongChain || tierGapBlocked;
  const budgetWei = budget ? String(Math.floor(parseFloat(budget) * 1e6)) : '0';

  const handleAttest = useCallback(async () => {
    if (!targetAgentId) {
      setError('Target agent ID is required');
      return;
    }
    if (!address) {
      setError('Connect a wallet first');
      return;
    }
    setStep('attesting');
    setError(null);

    try {
      // Step 1: persist the draft + get keccak256(draftHash)
      const draftRes = await fetch('/api/jobs/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          budgetUsdc: budget,
          minTier,
          minConfidence,
          chainId: 'arc',
          poster: address,
          targetAgentId,
          deadline: new Date(deadline).toISOString(),
        }),
      });
      if (!draftRes.ok) {
        const errBody = await draftRes.json().catch(() => ({}));
        throw new Error(errBody.error || `Draft save failed: ${draftRes.status}`);
      }
      const { draftHash: hash } = await draftRes.json();
      setDraftHash(hash);

      // Step 2: signed Caliber v2.0 rating attestation
      const tierName = TIER_NAME_MAP[minTier] ?? 'Provisional';
      const confName = CONFIDENCE_NAMES[minConfidence] ?? 'moderate';

      const res = await fetch(
        `${RATING_API_BASE}/v1/agents/arc/${targetAgentId}/attest`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ minTier: tierName, minConfidence: confName }),
        },
      );

      if (!res.ok) {
        const data = await res.json();
        if (res.status === 422) {
          if (data.reason === 'insufficient_interactions' || data.reason === 'insufficient_history') {
            setError(
              'This agent has no rating yet (insufficient interactions or history). Most agents need at least 5 completed jobs and 14 days of on-chain history.',
            );
          } else if (data.reason === 'unknown_identity') {
            setError(
              `Agent #${targetAgentId} has stats but no verified on-chain owner address. Cannot be hired through the gateway. Pick another agent.`,
            );
          } else if (data.reason === 'rating_below_threshold') {
            setError(
              `This agent's tier (${data.tier}) does not meet your minimum (${tierName}). Lower the minimum or pick a higher-tier agent.`,
            );
          } else if (data.reason === 'confidence_below_threshold') {
            setError(
              `This agent's confidence (${data.confidence}) is below your minimum. Allow lower confidence or pick a more-interacted agent.`,
            );
          } else {
            setError(data.detail || data.reason || 'Attestation failed');
          }
          setStep('error');
          return;
        }
        throw new Error(`Attestation request failed: ${res.status}`);
      }

      const data: AttestationResponse = await res.json();
      setAttestationData(data);
      setStep('approving');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get attestation');
      setStep('error');
    }
  }, [
    targetAgentId,
    minTier,
    minConfidence,
    address,
    title,
    description,
    budget,
    deadline,
  ]);

  const handleApprove = useCallback(() => {
    if (!attestationData || !address) return;
    writeUsdcApprove(
      {
        address: USDC_CONTRACT as `0x${string}`,
        abi: USDC_ABI as Abi,
        functionName: 'approve',
        args: [RATING_GATEWAY, BigInt(budgetWei)],
      },
      {
        onSuccess: () => setStep('posting'),
        onError: (err) => {
          setError(`USDC approval failed: ${err.message}`);
          setStep('error');
        },
      },
    );
  }, [attestationData, address, budgetWei, writeUsdcApprove]);

  const handlePostGatedJob = useCallback(() => {
    if (!attestationData || !address) return;
    const att = attestationData.attestation;
    const expiredAt = Math.floor(new Date(deadline).getTime() / 1000);

    // Embed draftHash marker so the indexer can rejoin the off-chain draft.
    const onchainDescription = draftHash
      ? `${title}\n\narcagents:draft:${draftHash}`
      : title;

    writeGateway(
      {
        address: RATING_GATEWAY as `0x${string}`,
        abi: RatingGateway_ABI as Abi,
        functionName: 'postGatedJob',
        args: [
          att.agentAddress as `0x${string}`,
          evaluatorAddress as `0x${string}`,
          BigInt(expiredAt),
          onchainDescription,
          BigInt(budgetWei),
          {
            chain: att.chain as `0x${string}`,
            agentId: BigInt(att.agentId),
            agentAddress: att.agentAddress as `0x${string}`,
            tier: att.tier,
            score: att.score,
            interactionCount: att.interactionCount,
            flags: att.flags,
            methodologyVersion: att.methodologyVersion as `0x${string}`,
            asOf: BigInt(att.asOf),
            validUntil: BigInt(att.validUntil),
            nonce: BigInt(att.nonce),
          },
          attestationData.signature as `0x${string}`,
          minTier,
          0, // blockingFlagMask = 0 — tier check already refuses Watch/Inactive
        ],
      },
      {
        onSuccess: async (hash) => {
          setStep('success');
          try {
            if (!publicClient) return;
            const receipt = await publicClient.waitForTransactionReceipt({ hash });
            const gatewayAddr = (RATING_GATEWAY as string).toLowerCase();
            for (const log of receipt.logs) {
              if (log.address.toLowerCase() !== gatewayAddr) continue;
              try {
                const decoded = decodeEventLog({
                  abi: RatingGateway_ABI as Abi,
                  data: log.data,
                  topics: log.topics,
                });
                if (decoded.eventName === 'JobPostedWithRating') {
                  const args = decoded.args as unknown as { jobId: bigint };
                  const id = args.jobId.toString();
                  setCreatedJobId(id);
                  router.push(`/jobs/${id}`);
                  return;
                }
              } catch {
                // not our event
              }
            }
          } catch {
            // receipt fetch failed; success card still shows
          }
        },
        onError: (err) => {
          setError(`Job posting failed: ${err.message}`);
          setStep('error');
        },
      },
    );
  }, [
    attestationData,
    address,
    evaluatorAddress,
    deadline,
    title,
    budgetWei,
    minTier,
    minConfidence,
    writeGateway,
    draftHash,
    publicClient,
    router,
  ]);

  // Caliber audit-report styling: paper bg, hairline borders, mono inputs.
  const inputClass =
    'w-full px-3 py-2 bg-white border border-[var(--color-hairline)] rounded-[2px] text-sm focus:outline-none focus:border-[var(--color-ink)] font-mono';
  const labelClass = 'block text-sm font-medium mb-1 text-[var(--color-ink)]';
  const noteClass = 'mt-1.5 text-xs text-[var(--color-mute)] leading-snug';

  return (
    <div className="space-y-6">

      {!isConnected && (
        <div className="border border-[var(--color-hairline)] bg-[var(--color-bg-elev)] rounded-[2px] p-5 text-center">
          <p className="text-[var(--color-mute)] mb-3 text-sm">Connect your wallet to post a job.</p>
          <ConnectKitButton />
        </div>
      )}

      {wrongChain && (
        <div className="border border-[var(--color-signal-down)] bg-white rounded-[2px] p-4 text-sm text-[var(--color-signal-down)]">
          Wrong network. Switch your wallet to Arc Testnet (chain id {arcTestnet.id}).
        </div>
      )}

      {isConnected && (
        <p className="text-xs text-[var(--color-mute)] font-mono">
          connected · {address?.slice(0, 10)}…{address?.slice(-4)}
        </p>
      )}

      {error && (
        <div className="border border-[var(--color-signal-down)] bg-white rounded-[2px] p-4 text-sm text-[var(--color-signal-down)] flex items-baseline justify-between gap-4">
          <span>{error}</span>
          <button
            className="font-mono text-xs underline shrink-0"
            onClick={() => {
              setError(null);
              setStep('form');
            }}
          >
            retry
          </button>
        </div>
      )}

      {step === 'form' && (
        <div className="border border-[var(--color-hairline)] bg-white rounded-[2px] p-6 space-y-4">
          <h2 className="font-mono text-[13px] text-[var(--color-ink)] tracking-[0.02em] pb-2 border-b-2 border-[var(--color-ink)]">
            //job_details
          </h2>

          <div>
            <label className={labelClass}>Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={60}
              className={inputClass}
              placeholder="e.g., translate marketing copy to thai"
            />
          </div>

          <div>
            <label className={labelClass}>Description *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={4}
              className={inputClass}
              placeholder="deliverables, requirements, acceptance criteria"
            />
            <p className={noteClass}>{description.length}/2000</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Budget (USDC) *</label>
              <input
                type="number"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                min="1"
                max="1000"
                step="0.01"
                className={inputClass}
                placeholder="1.00"
              />
            </div>
            <div>
              <label className={labelClass}>Deadline *</label>
              <input
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Minimum rating *</label>
              <select
                value={minTier}
                onChange={(e) => setMinTier(Number(e.target.value))}
                className={inputClass}
              >
                {TIER_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <p className={noteClass}>The gateway refuses agents below this tier.</p>
            </div>
            <div>
              <label className={labelClass}>Minimum confidence *</label>
              <select
                value={minConfidence}
                onChange={(e) => setMinConfidence(Number(e.target.value))}
                className={inputClass}
              >
                {CONFIDENCE_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <p className={noteClass}>Higher confidence = more interaction history backing the rating.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-baseline justify-between mb-1">
                <label className={labelClass.replace('mb-1', '')}>Agent to hire *</label>
                <a href="/agents" className="text-[11px] font-mono text-[var(--color-copper)] hover:underline">
                  browse →
                </a>
              </div>
              <input
                type="text"
                value={targetAgentId}
                onChange={(e) => setTargetAgentId(e.target.value)}
                className={inputClass}
                placeholder="ERC-8004 agent id (e.g., 4102)"
              />
              <p className={noteClass}>
                Easiest: open <a href="/agents" className="text-[var(--color-copper)] underline">/agents</a>, click <strong>Hire</strong>, this auto-fills.
              </p>
            </div>
            <div>
              <div className="flex items-baseline justify-between mb-1">
                <label className={labelClass.replace('mb-1', '')}>Evaluator *</label>
                {address && evaluatorAddress !== address && (
                  <button
                    type="button"
                    onClick={() => setEvaluatorAddress(address)}
                    className="text-[11px] font-mono text-[var(--color-copper)] hover:underline"
                  >
                    use my wallet
                  </button>
                )}
              </div>
              <input
                type="text"
                value={evaluatorAddress}
                onChange={(e) => setEvaluatorAddress(e.target.value)}
                className={inputClass}
                placeholder="0x…"
              />
              <p className={noteClass}>
                The wallet that approves or rejects the deliverable. Defaults to your wallet (self-eval).
              </p>
            </div>
          </div>

          <TargetGateStatus check={targetCheck} minTierOrdinal={minTier} />

          <button
            onClick={handleAttest}
            disabled={submitDisabled}
            className="w-full py-3 px-4 bg-[var(--color-ink)] text-[var(--color-paper)] font-medium text-sm rounded-[2px] hover:bg-[#1c2028] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            get attestation & continue →
          </button>
        </div>
      )}

      {step === 'attesting' && (
        <div className="border border-[var(--color-copper)] bg-white rounded-[2px] p-6 text-center">
          <p className="font-mono text-sm text-[var(--color-copper)]">fetching signed attestation from caliber…</p>
        </div>
      )}

      {step === 'approving' && attestationData && (
        <div className="border border-[var(--color-hairline)] bg-white rounded-[2px] p-6 space-y-4">
          <h2 className="font-mono text-[13px] text-[var(--color-ink)] tracking-[0.02em] pb-2 border-b-2 border-[var(--color-ink)]">
            //popup_1 · approve usdc
          </h2>
          <AttestationInfo att={attestationData} />
          <p className="text-sm text-[var(--color-mute)]">
            Approve {budget} USDC to <code className="font-mono text-xs">{RATING_GATEWAY.slice(0, 10)}…</code>.
            The gateway pulls this on popup #2.
          </p>
          <button
            onClick={handleApprove}
            disabled={approvePending}
            className="w-full py-3 px-4 bg-[var(--color-ink)] text-[var(--color-paper)] font-medium text-sm rounded-[2px] hover:bg-[#1c2028] disabled:opacity-50 transition-colors"
          >
            {approvePending ? 'confirm in wallet…' : 'approve USDC'}
          </button>
        </div>
      )}

      {step === 'posting' && attestationData && (
        <div className="border border-[var(--color-hairline)] bg-white rounded-[2px] p-6 space-y-4">
          <h2 className="font-mono text-[13px] text-[var(--color-ink)] tracking-[0.02em] pb-2 border-b-2 border-[var(--color-ink)]">
            //popup_2 · post gated job
          </h2>
          <AttestationInfo att={attestationData} />
          <p className="text-sm text-[var(--color-mute)]">
            Gateway verifies the attestation on-chain, pulls USDC into escrow, creates the job.
          </p>
          <button
            onClick={handlePostGatedJob}
            disabled={postPending}
            className="w-full py-3 px-4 bg-[var(--color-ink)] text-[var(--color-paper)] font-medium text-sm rounded-[2px] hover:bg-[#1c2028] disabled:opacity-50 transition-colors"
          >
            {postPending ? 'confirm in wallet…' : 'post gated job'}
          </button>
        </div>
      )}

      {step === 'success' && (
        <div className="border-l-2 border-[var(--color-signal-up)] bg-[var(--color-bg-elev)] rounded-[2px] p-6 space-y-3">
          <h2 className="font-mono text-[13px] text-[var(--color-signal-up)] tracking-[0.02em] uppercase">
            ✓ job submitted
          </h2>
          <p className="text-sm text-[var(--color-ink)]">
            Job posted via gateway. <strong>Next:</strong> the agent calls{' '}
            <code className="font-mono text-xs">setBudget</code> on AgenticCommerce, then you return to
            the job page and click <strong>Fund Job</strong> (popup #3) to release escrow.
          </p>
          <div className="flex flex-wrap gap-2">
            {createdJobId ? (
              <a
                href={`/jobs/${createdJobId}`}
                className="inline-block px-4 py-2 bg-[var(--color-ink)] text-[var(--color-paper)] rounded-[2px] text-sm font-medium hover:bg-[#1c2028]"
              >
                view job #{createdJobId}
              </a>
            ) : (
              <span className="inline-block px-4 py-2 bg-white border border-[var(--color-hairline)] rounded-[2px] text-sm text-[var(--color-mute)] font-mono">
                parsing on-chain jobId…
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TargetGateStatus({
  check,
  minTierOrdinal,
}: {
  check: TargetCheck;
  minTierOrdinal: number;
}) {
  if (check.status === 'idle') return null;

  const minTierName = TIER_NAME_MAP[minTierOrdinal] ?? 'Provisional';

  if (check.status === 'loading') {
    return (
      <div className="border border-[var(--color-hairline)] bg-[var(--color-bg-elev)] rounded-[2px] px-4 py-3 text-xs font-mono text-[var(--color-mute)]">
        // pre-flight · checking caliber rating…
      </div>
    );
  }

  if (check.status === 'error') {
    return (
      <div className="border border-[var(--color-hairline)] bg-[var(--color-bg-elev)] rounded-[2px] px-4 py-3 text-xs font-mono text-[var(--color-mute)]">
        // pre-flight · rating lookup failed (will retry on submit)
      </div>
    );
  }

  if (check.status === 'unrated') {
    return (
      <div className="border-l-2 border-[var(--color-copper)] bg-white rounded-[2px] px-4 py-3 text-sm">
        <div className="font-mono text-[11px] text-[var(--color-copper)] uppercase tracking-[0.05em] mb-1">
          ⚠ pre-flight · no rating yet
        </div>
        <div className="text-[var(--color-ink)]">
          This agent has no Caliber rating (
          <span className="font-mono text-xs">{check.reason}</span>). The attestation
          step will refuse. Pick a more-interacted agent or one with ≥14 days history.
        </div>
      </div>
    );
  }

  // status === 'rated'
  if (check.meetsTier) {
    return (
      <div className="border-l-2 border-[var(--color-signal-up)] bg-white rounded-[2px] px-4 py-3 text-sm">
        <div className="font-mono text-[11px] text-[var(--color-signal-up)] uppercase tracking-[0.05em] mb-1">
          ✓ pre-flight · meets gate
        </div>
        <div className="text-[var(--color-ink)] flex items-baseline gap-3">
          <span>
            Agent is <strong className="font-mono">{check.tier}</strong> (
            <span className="font-mono">score {check.score}</span>,{' '}
            {check.confidence} confidence). Minimum: {minTierName}.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="border-l-2 border-[var(--color-signal-down)] bg-white rounded-[2px] px-4 py-3 text-sm">
      <div className="font-mono text-[11px] text-[var(--color-signal-down)] uppercase tracking-[0.05em] mb-1">
        ✗ pre-flight · blocked
      </div>
      <div className="text-[var(--color-ink)]">
        Agent is <strong className="font-mono">{check.tier}</strong>, requires{' '}
        <strong className="font-mono">{minTierName}</strong>. Lower the minimum tier or pick a
        higher-tier agent — submit is disabled until the gap closes.
      </div>
    </div>
  );
}

function AttestationInfo({ att }: { att: AttestationResponse }) {
  const tierName = TIER_NAME_MAP[att.attestation.tier] ?? `tier ${att.attestation.tier}`;
  return (
    <div className="bg-[var(--color-bg-elev)] border border-[var(--color-hairline)] rounded-[2px] p-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono">
      <div className="text-[var(--color-mute)]">tier</div>
      <div className="text-[var(--color-ink)] font-medium text-right">{tierName}</div>
      <div className="text-[var(--color-mute)]">score</div>
      <div className="text-[var(--color-ink)] text-right">{att.attestation.score} / 100</div>
      <div className="text-[var(--color-mute)]">confidence</div>
      <div className="text-[var(--color-ink)] text-right">{att.confidence ?? '—'}</div>
      <div className="text-[var(--color-mute)]">interactions</div>
      <div className="text-[var(--color-ink)] text-right">{att.attestation.interactionCount}</div>
      <div className="text-[var(--color-mute)]">flags</div>
      <div className="text-[var(--color-ink)] text-right">
        {att.flags && att.flags.length > 0 ? att.flags.join(', ') : 'none'}
      </div>
      <div className="text-[var(--color-mute)]">valid until</div>
      <div className="text-[var(--color-ink)] text-right">{new Date(att.validUntil * 1000).toLocaleTimeString()}</div>
      <div className="text-[var(--color-mute)]">methodology</div>
      <div className="text-[var(--color-ink)] text-right">v{att.methodologyVersion}</div>
    </div>
  );
}
