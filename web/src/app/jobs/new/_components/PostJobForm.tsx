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

const TIER_OPTIONS = [
  { value: 0, label: 'Caliber-AAA (< 0.4% PD)' },
  { value: 1, label: 'Caliber-AA (0.4–1.0%)' },
  { value: 2, label: 'Caliber-A (1.0–2.5%)' },
  { value: 3, label: 'Caliber-BBB (2.5–6.0%)' },
  { value: 4, label: 'Caliber-BB (6.0–13.0%)' },
  { value: 5, label: 'Caliber-B (13.0–22.0%)' },
];

const CONFIDENCE_OPTIONS = [
  { value: 0, label: 'High (≥75 interactions)' },
  { value: 1, label: 'Medium (25–74)' },
  { value: 2, label: 'Low (5–24, warned)' },
];

const TIER_NAME_MAP: Record<number, string> = {
  0: 'Caliber-AAA',
  1: 'Caliber-AA',
  2: 'Caliber-A',
  3: 'Caliber-BBB',
  4: 'Caliber-BB',
  5: 'Caliber-B',
  6: 'Caliber-CCC',
  7: 'Caliber-CC',
  8: 'Caliber-D',
};

type Step = 'form' | 'attesting' | 'approving' | 'posting' | 'success' | 'error';

interface AttestationResponse {
  attestation: {
    chain: string;
    agentId: string;
    agentAddress: string;
    tier: number;
    pdBps: number;
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

  const submitDisabled =
    !title || !description || !budget || !targetAgentId || !evaluatorAddress || !isConnected || wrongChain;
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

      // Step 2: signed rating attestation from Caliber
      const tierName = TIER_NAME_MAP[minTier] ?? 'Caliber-BBB';
      const confName = minConfidence === 0 ? 'high' : minConfidence === 1 ? 'medium' : 'low';

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
              'This agent has no rating yet (insufficient confidence). Most agents need at least 5 interactions and 14 days of history.',
            );
          } else if (data.reason === 'unknown_identity') {
            setError(
              `Agent #${targetAgentId} has stats but no verified on-chain owner address. Cannot be hired through the gateway. Pick another agent.`,
            );
          } else if (data.reason === 'rating_below_threshold') {
            setError(
              `This agent's rating is below your threshold (${data.rating}). Lower the minimum or pick a higher-rated agent.`,
            );
          } else if (data.reason === 'confidence_below_threshold') {
            setError(
              `This agent's confidence (${data.confidence}) is below your minimum. Allow "Low" confidence or pick a more-interacted agent.`,
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
            pdBps: att.pdBps,
            confidence: att.confidence,
            methodologyVersion: att.methodologyVersion as `0x${string}`,
            asOf: BigInt(att.asOf),
            validUntil: BigInt(att.validUntil),
            nonce: BigInt(att.nonce),
          },
          attestationData.signature as `0x${string}`,
          minTier,
          minConfidence,
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

function AttestationInfo({ att }: { att: AttestationResponse }) {
  const tierName = TIER_NAME_MAP[att.attestation.tier] ?? `tier ${att.attestation.tier}`;
  const confName =
    att.attestation.confidence === 0 ? 'high'
    : att.attestation.confidence === 1 ? 'medium'
    : 'low';
  return (
    <div className="bg-[var(--color-bg-elev)] border border-[var(--color-hairline)] rounded-[2px] p-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono">
      <div className="text-[var(--color-mute)]">rating</div>
      <div className="text-[var(--color-ink)] font-medium text-right">{tierName}</div>
      <div className="text-[var(--color-mute)]">ppd</div>
      <div className="text-[var(--color-ink)] text-right">{(att.attestation.pdBps / 100).toFixed(2)}%</div>
      <div className="text-[var(--color-mute)]">confidence</div>
      <div className="text-[var(--color-ink)] text-right">{confName}</div>
      <div className="text-[var(--color-mute)]">valid until</div>
      <div className="text-[var(--color-ink)] text-right">{new Date(att.validUntil * 1000).toLocaleTimeString()}</div>
      <div className="text-[var(--color-mute)]">methodology</div>
      <div className="text-[var(--color-ink)] text-right">v{att.methodologyVersion}</div>
    </div>
  );
}
