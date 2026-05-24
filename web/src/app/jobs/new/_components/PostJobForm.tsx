'use client';

import { useState, useCallback, useEffect } from 'react';
import { useAccount, useWriteContract, useChainId, usePublicClient } from 'wagmi';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  USDC_CONTRACT,
  RATING_GATEWAY,
} from '@/lib/contracts/addresses';
import { arcTestnet } from '@/lib/wagmi/chains';
import USDC_ABI from '@/lib/contracts/abis/USDC.json';
import RatingGateway_ABI from '@/lib/contracts/abis/RatingGateway.json';
import { type Abi, decodeEventLog } from 'viem';
import { api, type CaliberTier } from '@/lib/api';
import { AgentPicker } from './AgentPicker';
import { useCaliberWallet } from '@/lib/wallet/useCaliberWallet';
import { useCircleAuth } from '@/lib/circle/AuthContext';

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

// v2.0 bond rate in basis points per tier, used for the bond preview
// shown to the poster before they commit. Mirrors CaliberEscrow's
// initial table (50/150/500/1500/0/0).
const BOND_BPS_BY_TIER: Record<CaliberTier, number> = {
  Established: 50,
  Proven: 150,
  Emerging: 500,
  Provisional: 1500,
  Watch: 0,
  Inactive: 0,
};

// Sample templates for B4 — let judges fill the form in one click.
const SAMPLE_TEMPLATES: Array<{
  label: string;
  title: string;
  description: string;
  budget: string;
}> = [
  {
    label: 'translation',
    title: 'translate marketing copy to thai',
    description:
      'Translate 500 words of marketing copy from English to Thai. Tone should be casual but professional. Return as a single markdown document with the original and translation side-by-side.',
    budget: '5',
  },
  {
    label: 'pdf summary',
    title: 'summarize PDF report',
    description:
      'Read the attached 20-page market research PDF and produce a 1-page executive summary: 3 key findings, 2 risks, 1 recommendation. Use bullet points.',
    budget: '3',
  },
  {
    label: 'tweet thread',
    title: 'tweet thread about agent commerce',
    description:
      'Write a 5-tweet thread about why agent-to-agent commerce needs trust primitives. Use accessible language for a crypto-native audience.',
    budget: '2',
  },
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
  // Unified wallet state (MetaMask via wagmi OR Circle Google). The Hire
  // button below dispatches by wallet.type to the right signing flow.
  const wallet = useCaliberWallet();
  const circle = useCircleAuth();
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
  // Caliber bond is opt-in per job. When true, the agent is expected to
  // post a bond before accepting; CaliberBondPanel only renders on
  // /jobs/[id] when this flag was set at post-time.
  const [bondRequired, setBondRequired] = useState(false);

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

  // Basic mode hides advanced inputs (deadline, min tier, min confidence,
  // evaluator) and uses sensible defaults. Toggle reveals everything for
  // power users / integrators who need to override.
  const [mode, setMode] = useState<'basic' | 'advanced'>('basic');

  // Form-data getter used by the Circle Hire dispatcher. Returns null until
  // the four essentials are filled. Server applies defaults for deadline /
  // evaluator when omitted in basic mode.
  const getJobFormData = useCallback(() => {
    if (!title || !description || !budget || !targetAgentId) return null;
    const tierName = (['Established', 'Proven', 'Emerging', 'Provisional'][minTier] ??
      'Provisional') as 'Established' | 'Proven' | 'Emerging' | 'Provisional';
    const confName = (['high', 'moderate', 'low'][minConfidence] ?? 'moderate') as
      | 'high'
      | 'moderate'
      | 'low';
    return {
      title,
      description,
      budgetUsdc: budget,
      minTier: tierName,
      minConfidence: confName,
      targetAgentId,
      evaluatorAddress: evaluatorAddress || undefined,
      deadline: mode === 'advanced' ? deadline : undefined,
      bondRequired,
    };
  }, [title, description, budget, minTier, minConfidence, targetAgentId, evaluatorAddress, deadline, mode, bondRequired]);

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
  // Disabled until the four essentials are filled + tier check is passing.
  // Wallet-connection state is rendered via the Hire button text instead of
  // disabling the button — clicking when disconnected opens the wallet picker.
  const formIncomplete =
    !title || !description || !budget || !targetAgentId || tierGapBlocked;
  // MetaMask needs evaluator + correct chain; Circle handles both server-side.
  const metamaskBlocked =
    wallet.type === 'metamask' && (!evaluatorAddress || wrongChain);
  const submitDisabled = formIncomplete || metamaskBlocked;
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
          bondRequired,
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

  // === Circle Google → run gated job via Circle SDK challenges ===========
  const handleCircleHire = useCallback(async () => {
    if (!wallet.address || wallet.type !== 'circle') return;
    const form = getJobFormData();
    if (!form) {
      setError('Fill in the form first — title, description, budget, agent.');
      setStep('error');
      return;
    }
    setError(null);
    try {
      setStep('approving');
      const approveChallengeId = await circle.approveChallenge(form.budgetUsdc);
      const approveRes = await circle.runChallenge(approveChallengeId);
      if (approveRes.errorMessage) throw new Error(`approve: ${approveRes.errorMessage}`);

      setStep('posting');
      const { challengeId: postChallengeId, draftHash: dh } = await circle.postJobChallenge(form);
      setDraftHash(dh);
      // Capture the block height BEFORE the post tx so we can scan forward.
      const beforeBlock = publicClient ? await publicClient.getBlockNumber() : BigInt(0);
      const postRes = await circle.runChallenge(postChallengeId);
      if (postRes.errorMessage) throw new Error(`post: ${postRes.errorMessage}`);

      // Circle's challenge result for CREATE_TRANSACTION challenges doesn't
      // expose txHash directly (only SIGN_TRANSACTION does). Instead, scan
      // the chain forward from the pre-post block for our wallet's most
      // recent JobPostedWithRating event.
      if (publicClient && wallet.address) {
        const posterLower = wallet.address.toLowerCase();
        for (let attempt = 0; attempt < 15; attempt++) {
          try {
            const current = await publicClient.getBlockNumber();
            if (current >= beforeBlock) {
              const logs = await publicClient.getLogs({
                address: RATING_GATEWAY as `0x${string}`,
                fromBlock: beforeBlock,
                toBlock: current,
              });
              for (const log of logs) {
                try {
                  const decoded = decodeEventLog({
                    abi: RatingGateway_ABI as Abi,
                    data: log.data,
                    topics: log.topics,
                  });
                  if (decoded.eventName === 'JobPostedWithRating') {
                    const args = decoded.args as unknown as {
                      jobId: bigint;
                      poster: string;
                    };
                    if (args.poster?.toLowerCase() === posterLower) {
                      const id = args.jobId.toString();
                      setCreatedJobId(id);
                      setStep('success');
                      router.push(`/jobs/${id}`);
                      return;
                    }
                  }
                } catch { /* not our event */ }
              }
            }
          } catch { /* RPC hiccup; retry */ }
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      // Fallthrough: tx succeeded but we couldn't pin down jobId. User can
      // still navigate to /jobs to find their post.
      setStep('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'circle hire failed');
      setStep('error');
    }
  }, [wallet, circle, getJobFormData, publicClient, router]);

  // Dispatcher: routes the Hire click to the right signing flow.
  const handleHire = useCallback(() => {
    if (wallet.type === 'metamask') {
      handleAttest();
    } else if (wallet.type === 'circle') {
      void handleCircleHire();
    }
  }, [wallet.type, handleAttest, handleCircleHire]);

  return (
    <div className="space-y-6">

      {wrongChain && (
        <div className="border border-[var(--color-signal-down)] bg-white rounded-[2px] p-4 text-sm text-[var(--color-signal-down)]">
          Wrong network. Switch your wallet to Arc Testnet (chain id {arcTestnet.id}).
        </div>
      )}

      {wallet.isConnected && wallet.address && (
        <p className="text-xs text-[var(--color-mute)] font-mono">
          connected · {wallet.address.slice(0, 10)}…{wallet.address.slice(-4)} · {wallet.label}
          {wallet.email && ` · ${wallet.email}`}
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
          {/* === B1: 4-step progress bar ================================= */}
          <ProgressBar
            connected={wallet.isConnected}
            walletLabel={wallet.label}
            filled={Boolean(title && description && budget && targetAgentId)}
          />

          {/* === D3: link to a real completed job so judges can preview the
              happy path before posting their own. */}
          <CompletedExampleLink />

          <div className="flex items-baseline justify-between pb-2 border-b-2 border-[var(--color-ink)]">
            <h2 className="font-mono text-[13px] text-[var(--color-ink)] tracking-[0.02em]">
              //job_details
            </h2>
            <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-[var(--color-mute)]">
              mode · {mode}
            </span>
          </div>

          {/* === B4: sample templates ==================================== */}
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-[var(--color-mute)]">
              //quick_start
            </span>
            {SAMPLE_TEMPLATES.map((t) => (
              <button
                key={t.label}
                type="button"
                onClick={() => {
                  setTitle(t.title);
                  setDescription(t.description);
                  setBudget(t.budget);
                }}
                className="font-mono text-[11px] px-2 py-0.5 border border-[var(--color-hairline)] hover:border-[var(--color-copper)] text-[var(--color-mute)] hover:text-[var(--color-copper)] rounded-[2px] transition"
                title={`Title: ${t.title} · ${t.budget} USDC`}
              >
                {t.label} →
              </button>
            ))}
          </div>

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

          {/* === Agent picker — searchable + tier-filterable list ========== */}
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <label className={labelClass.replace('mb-1', '')}>Agent to hire *</label>
              <a
                href="/agents"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-mono text-[var(--color-copper)] hover:underline"
              >
                browse all (new tab) ↗
              </a>
            </div>
            <AgentPicker
              selectedId={targetAgentId}
              onSelect={setTargetAgentId}
              minTierOrdinal={minTier}
              showTierFilter
            />
            <input
              type="text"
              value={targetAgentId}
              onChange={(e) => setTargetAgentId(e.target.value)}
              className={inputClass + ' mt-2'}
              placeholder="or paste an ERC-8004 agent id"
            />
            <p className={noteClass}>
              Pick from the list above (filtered to demo-ready agents) or paste any id.
            </p>

          </div>

          {/* === Advanced fields (deadline, tier, confidence, evaluator, bond) === */}
          {mode === 'advanced' && (
            <div className="space-y-4 pt-4 border-t border-dashed border-[var(--color-hairline)]">
              <p className="font-mono text-[10px] uppercase tracking-[0.05em] text-[var(--color-mute)]">
                //advanced_options
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Deadline</label>
                  <input
                    type="datetime-local"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    className={inputClass}
                  />
                  <p className={noteClass}>Defaults to +7 days.</p>
                </div>
                <div>
                  <label className={labelClass}>Minimum rating</label>
                  <select
                    value={minTier}
                    onChange={(e) => setMinTier(Number(e.target.value))}
                    className={inputClass}
                  >
                    {TIER_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  <p className={noteClass}>Gateway refuses agents below this tier. Default: Provisional or better.</p>
                  {/* A1: per-tier bond rate cheat-sheet so the poster knows
                      what their tier choice implies for the agent's bond. */}
                  <details className="mt-1.5 text-[11px] text-[var(--color-mute)]">
                    <summary className="cursor-pointer hover:text-[var(--color-ink)] font-mono">
                      what does each tier mean?
                    </summary>
                    <ul className="mt-1.5 space-y-0.5 pl-3 font-mono leading-relaxed">
                      <li><strong className="text-[var(--color-ink)]">Established</strong>: score ≥80 + ≥50 jobs. Bond: 0.5% of budget.</li>
                      <li><strong className="text-[var(--color-ink)]">Proven</strong>: score ≥65 + ≥20 jobs. Bond: 1.5%.</li>
                      <li><strong className="text-[var(--color-ink)]">Emerging</strong>: score ≥50 + ≥5 jobs. Bond: 5%.</li>
                      <li><strong className="text-[var(--color-ink)]">Provisional</strong>: fallback when above not met. Bond: 15%.</li>
                      <li>Watch / Inactive: refused by gateway regardless of selection.</li>
                    </ul>
                  </details>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Minimum confidence</label>
                  <select
                    value={minConfidence}
                    onChange={(e) => setMinConfidence(Number(e.target.value))}
                    className={inputClass}
                  >
                    {CONFIDENCE_OPTIONS.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                  <p className={noteClass}>Default: Moderate (≥25 completed jobs).</p>
                </div>
                <div>
                  <div className="flex items-baseline justify-between mb-1">
                    <label className={labelClass.replace('mb-1', '')}>Evaluator</label>
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
                    Defaults to your wallet (self-eval). Demo path uses the Circle wallet automatically.
                  </p>
                </div>
              </div>

              {/* Caliber bond — opt-in per job. Lives in advanced because
                  it's the v2.0 reference-implementation feature, not the
                  default flow. When unchecked, /jobs/[id] won't render the
                  bond panel at all. */}
              <div className="border-t border-dashed border-[var(--color-hairline)] pt-4 space-y-2">
                <label className="flex items-start gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={bondRequired}
                    onChange={(e) => setBondRequired(e.target.checked)}
                    className="mt-0.5 accent-[var(--color-copper)]"
                  />
                  <span className="text-sm text-[var(--color-ink)] leading-snug">
                    <span className="font-medium">Require Caliber bond from the agent</span>
                    <span className="block text-xs text-[var(--color-mute)] mt-0.5">
                      Agent locks USDC sized by their tier as skin in the game. Returns on
                      completion; slashes to you on rejection/expiry. Opt-in per job — leave
                      unchecked to skip the bond step entirely.
                    </span>
                  </span>
                </label>

                {/* A3: bond preview — only meaningful when bond is required
                    AND an agent + budget have been picked. */}
                {bondRequired && targetCheck.status === 'rated' && budget && (
                  <div className="border-l-2 border-[var(--color-copper)] bg-[var(--color-bg-elev)] px-3 py-2 text-xs space-y-0.5 ml-6">
                    <p className="font-mono text-[10px] uppercase tracking-[0.05em] text-[var(--color-copper)]">
                      //bond_preview
                    </p>
                    {(() => {
                      const bondBps = BOND_BPS_BY_TIER[targetCheck.tier] ?? 0;
                      const budgetNum = parseFloat(budget) || 0;
                      const bondAmount = (budgetNum * bondBps) / 10_000;
                      if (bondBps === 0) {
                        return (
                          <p className="text-[var(--color-ink)]">
                            Agent is <strong>{targetCheck.tier}</strong> — gateway refuses this tier.
                            Bond is not posted because the job won&apos;t be accepted.
                          </p>
                        );
                      }
                      return (
                        <p className="text-[var(--color-ink)] leading-relaxed">
                          Agent is <strong>{targetCheck.tier}</strong>. If they accept this job
                          they&apos;ll lock{' '}
                          <strong className="font-mono">{bondAmount.toFixed(4)} USDC</strong>{' '}
                          ({(bondBps / 100).toFixed(2)}% of {budget} USDC budget) as a Caliber bond.
                        </p>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* === Mode toggle ============================================== */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setMode((m) => (m === 'basic' ? 'advanced' : 'basic'))}
              className="text-[11px] font-mono text-[var(--color-copper)] hover:underline"
            >
              {mode === 'basic' ? 'advanced options ↓' : '← back to basic mode'}
            </button>
          </div>

          <TargetGateStatus check={targetCheck} minTierOrdinal={minTier} />

          {!wallet.isConnected ? (
            <div className="border-l-2 border-[var(--color-copper)] bg-[var(--color-bg-elev)] px-4 py-3 text-sm text-[var(--color-ink)]">
              Connect a wallet (top-right) to hire. MetaMask or Google sign-in both work.
            </div>
          ) : (
            <button
              onClick={handleHire}
              disabled={submitDisabled}
              className="w-full py-3 px-4 bg-[var(--color-ink)] text-[var(--color-paper)] font-medium text-sm rounded-[2px] hover:bg-[#1c2028] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              hire — post gated job
              <span className="opacity-60 font-mono text-[11px] ml-2">via {wallet.label}</span>
            </button>
          )}
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
        <div className="border-l-2 border-[var(--color-signal-up)] bg-[var(--color-bg-elev)] rounded-[2px] p-6 space-y-5">
          <div className="space-y-1">
            <h2 className="font-mono text-[13px] text-[var(--color-signal-up)] tracking-[0.02em] uppercase">
              ✓ your job is on chain
            </h2>
            {createdJobId ? (
              <p className="text-xs text-[var(--color-mute)] font-mono">
                job #{createdJobId} · gated by Caliber · funded in USDC
              </p>
            ) : (
              <p className="text-xs text-[var(--color-mute)] font-mono">
                scanning chain for jobId… (post tx confirmed)
              </p>
            )}
          </div>

          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.05em] text-[var(--color-mute)] mb-2">
              //what_happens_next
            </p>
            <ol className="text-sm text-[var(--color-ink)] space-y-1.5 leading-relaxed pl-5 list-decimal">
              <li>
                The agent reviews your job and calls{' '}
                <code className="font-mono text-xs">setBudget</code> on AgenticCommerce
                to accept it.
              </li>
              <li>
                The agent commits a USDC bond keyed to their Caliber tier
                (skin in the game — slashed to you on rejection/expiry).
              </li>
              <li>The agent submits the deliverable.</li>
              <li>Your evaluator approves or rejects.</li>
              <li>
                USDC settles: bond returns to agent, budget releases on
                approval (or refunds to you on rejection).
              </li>
            </ol>
          </div>

          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.05em] text-[var(--color-mute)] mb-2">
              //watch_the_action
            </p>
            <div className="flex flex-wrap gap-2 text-sm">
              {createdJobId ? (
                <a
                  href={`/jobs/${createdJobId}`}
                  className="inline-block px-4 py-2 bg-[var(--color-ink)] text-[var(--color-paper)] rounded-[2px] font-medium hover:bg-[#1c2028]"
                >
                  view job #{createdJobId} →
                </a>
              ) : (
                <a
                  href="/jobs"
                  className="inline-block px-4 py-2 bg-[var(--color-ink)] text-[var(--color-paper)] rounded-[2px] font-medium hover:bg-[#1c2028]"
                >
                  browse all jobs →
                </a>
              )}
              <a
                href="/watchlist"
                className="inline-block px-4 py-2 bg-white border border-[var(--color-hairline)] hover:border-[var(--color-ink)] rounded-[2px]"
                title="See tier transitions fired by Sentinel"
              >
                watchlist
              </a>
              {wallet.address && (
                <a
                  href={`https://testnet.arcscan.app/address/${wallet.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block px-4 py-2 bg-white border border-[var(--color-hairline)] hover:border-[var(--color-ink)] rounded-[2px]"
                  title="See your wallet's on-chain activity"
                >
                  on Arcscan ↗
                </a>
              )}
            </div>
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

/**
 * B1: 4-step progress bar that frames where the user is in the post-job
 * flow. Steps:
 *   1. Fill form           → active until all 4 essentials are entered
 *   2. Connect wallet      → active once form is filled but no wallet connected
 *   3. Sign on-chain       → active when wallet is connected, awaiting Hire click
 *   4. Job posted          → reached only post-success (covered by step='success' branch)
 *
 * Renders compact, never disabled / clickable. Pure visual cue for judges.
 */
function ProgressBar({
  connected,
  walletLabel,
  filled,
}: {
  connected: boolean;
  walletLabel: string | null;
  filled: boolean;
}) {
  const current = !filled ? 0 : !connected ? 1 : 2;
  const steps = [
    { label: 'fill form' },
    { label: 'connect wallet' },
    { label: `sign on-chain${walletLabel ? ` · ${walletLabel.toLowerCase()}` : ''}` },
    { label: 'job posted' },
  ];
  return (
    <ol className="flex items-center gap-1.5 flex-wrap pb-1">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s.label} className="flex items-center gap-1.5">
            <span
              className={
                'flex items-center justify-center w-5 h-5 rounded-full font-mono text-[10px] border ' +
                (done
                  ? 'bg-[var(--color-ink)] text-[var(--color-paper)] border-[var(--color-ink)]'
                  : active
                    ? 'bg-[var(--color-copper)] text-white border-[var(--color-copper)] animate-pulse'
                    : 'bg-white text-[var(--color-mute)] border-[var(--color-hairline)]')
              }
            >
              {done ? '✓' : i + 1}
            </span>
            <span
              className={
                'font-mono text-[10px] uppercase tracking-[0.05em] ' +
                (active
                  ? 'text-[var(--color-ink)]'
                  : done
                    ? 'text-[var(--color-mute)]'
                    : 'text-[var(--color-mute)] opacity-60')
              }
            >
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <span className="text-[10px] text-[var(--color-mute)] opacity-50 mx-0.5">·</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * D3: small inline link that points to the most recent completed job so
 * judges have a happy-path example to view before posting their own.
 * Fetches once on mount; silently absent if no completed jobs exist yet.
 */
function CompletedExampleLink() {
  const [jobId, setJobId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .jobs({ status: 'Completed', limit: 1, sort: 'recent' })
      .then((d) => {
        if (cancelled) return;
        const j = d.jobs[0] as { jobId?: string | number } | undefined;
        if (j?.jobId) setJobId(String(j.jobId));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  if (!jobId) return null;
  return (
    <p className="font-mono text-[11px] text-[var(--color-mute)]">
      <span className="uppercase tracking-[0.05em] text-[10px] mr-1">//see_example</span>
      curious what a completed gated job looks like?{' '}
      <a
        href={`/jobs/${jobId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[var(--color-copper)] hover:underline"
      >
        view job #{jobId} ↗
      </a>
    </p>
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
