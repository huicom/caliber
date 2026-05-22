'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createPublicClient, http, recoverTypedDataAddress, hexToString } from 'viem';
import { arcTestnet } from '@/lib/wagmi/chains';
import { RATING_VERIFIER } from '@/lib/contracts/addresses';

const RATING_API_BASE =
  process.env.NEXT_PUBLIC_RATING_API_BASE ?? 'https://caliber-api.poko.blue';

const TIER_NAMES = ['Established', 'Proven', 'Emerging', 'Provisional', 'Watch', 'Inactive'];

const FLAG_NAMES = [
  'CounterpartyConcentration', // 0x01
  'ValidatorConcentration',    // 0x02
  'SybilPattern',              // 0x04
  'VolumeAnomaly',             // 0x08
  'Dormancy',                  // 0x10
];

const VERIFIER_ABI = [
  { type: 'function', name: 'signer', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'methodologyVersion', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'previousMethodologyVersion', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
] as const;

const ATTESTATION_TYPES = {
  RatingAttestation: [
    { name: 'chain', type: 'bytes32' },
    { name: 'agentId', type: 'uint256' },
    { name: 'agentAddress', type: 'address' },
    { name: 'tier', type: 'uint8' },
    { name: 'score', type: 'uint8' },
    { name: 'interactionCount', type: 'uint16' },
    { name: 'flags', type: 'uint8' },
    { name: 'methodologyVersion', type: 'bytes32' },
    { name: 'asOf', type: 'uint64' },
    { name: 'validUntil', type: 'uint64' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

interface Attestation {
  chain: `0x${string}`;
  agentId: string;
  agentAddress: `0x${string}`;
  tier: number;
  score: number;
  interactionCount: number;
  flags: number;
  methodologyVersion: `0x${string}`;
  asOf: string;
  validUntil: string;
  nonce: string;
}

interface Envelope {
  attestation: Attestation;
  signature: `0x${string}`;
}

interface OnChainConfig {
  signer: `0x${string}`;
  currentMethodology: `0x${string}`;
  previousMethodology: `0x${string}`;
}

interface VerifyResult {
  ok: boolean;
  checks: Array<{ name: string; pass: boolean; detail?: string }>;
  recoveredSigner?: string;
  decoded?: {
    tierName: string;
    flagNames: string[];
    chainName: string;
    methodologyVersionString: string;
    expiresIn: string;
  };
}

function flagsToNames(mask: number): string[] {
  return FLAG_NAMES.filter((_, i) => (mask & (1 << i)) !== 0);
}

function bytes32ToTrimmedString(hex: `0x${string}`): string {
  try {
    return hexToString(hex, { size: 32 }).replace(/\0+$/, '');
  } catch {
    return hex;
  }
}

function relativeWindow(epochSec: string): string {
  const t = Number(epochSec);
  if (!Number.isFinite(t)) return 'invalid';
  const ms = t * 1000 - Date.now();
  if (ms < 0) return `expired ${Math.round(-ms / 1000)}s ago`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}min`;
  return `${Math.round(ms / 3_600_000)}h`;
}

export function VerifyForm() {
  const sp = useSearchParams();
  const prefillChain = sp.get('chain') ?? '';
  const prefillId = sp.get('id') ?? '';

  const [jsonText, setJsonText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chainConfig, setChainConfig] = useState<OnChainConfig | null>(null);
  const [chainErr, setChainErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadOnChain() {
      try {
        const client = createPublicClient({ chain: arcTestnet, transport: http() });
        const [signer, current, previous] = await Promise.all([
          client.readContract({ address: RATING_VERIFIER as `0x${string}`, abi: VERIFIER_ABI, functionName: 'signer' }),
          client.readContract({ address: RATING_VERIFIER as `0x${string}`, abi: VERIFIER_ABI, functionName: 'methodologyVersion' }),
          client.readContract({ address: RATING_VERIFIER as `0x${string}`, abi: VERIFIER_ABI, functionName: 'previousMethodologyVersion' }),
        ]);
        if (cancelled) return;
        setChainConfig({
          signer: signer as `0x${string}`,
          currentMethodology: current as `0x${string}`,
          previousMethodology: previous as `0x${string}`,
        });
      } catch (e) {
        if (!cancelled) setChainErr(e instanceof Error ? e.message : 'rpc failed');
      }
    }
    void loadOnChain();
    return () => {
      cancelled = true;
    };
  }, []);

  async function fetchPrefill() {
    if (!prefillChain || !prefillId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${RATING_API_BASE}/v1/agents/${prefillChain}/${prefillId}/attest`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ minTier: 'Inactive' }),
          cache: 'no-store',
        },
      );
      if (!res.ok) throw new Error(`attest endpoint returned ${res.status}`);
      const env = await res.json();
      setJsonText(JSON.stringify(env, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch failed');
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      if (!chainConfig) throw new Error('on-chain verifier config not loaded — retry in a moment');
      const env = JSON.parse(jsonText) as Envelope;
      const att = env.attestation;
      if (!att || !env.signature) throw new Error('JSON must contain { attestation, signature }');

      const message = {
        chain: att.chain,
        agentId: BigInt(att.agentId),
        agentAddress: att.agentAddress,
        tier: att.tier,
        score: att.score,
        interactionCount: att.interactionCount,
        flags: att.flags,
        methodologyVersion: att.methodologyVersion,
        asOf: BigInt(att.asOf),
        validUntil: BigInt(att.validUntil),
        nonce: BigInt(att.nonce),
      };

      const recovered = await recoverTypedDataAddress({
        domain: {
          name: 'Caliber',
          version: '1',
          chainId: arcTestnet.id,
          verifyingContract: RATING_VERIFIER as `0x${string}`,
        },
        types: ATTESTATION_TYPES,
        primaryType: 'RatingAttestation',
        message,
        signature: env.signature,
      });

      const signerMatch = recovered.toLowerCase() === chainConfig.signer.toLowerCase();
      const methodologyMatch =
        att.methodologyVersion.toLowerCase() === chainConfig.currentMethodology.toLowerCase() ||
        att.methodologyVersion.toLowerCase() === chainConfig.previousMethodology.toLowerCase();
      const notExpired = BigInt(Math.floor(Date.now() / 1000)) <= BigInt(att.validUntil);
      const tierValid = att.tier >= 0 && att.tier <= 5;
      const flagsValid = att.flags >= 0 && att.flags <= 0x1f;

      const checks = [
        {
          name: 'signature recovers to the on-chain signer',
          pass: signerMatch,
          detail: signerMatch
            ? `recovered ${recovered.slice(0, 10)}…${recovered.slice(-6)} = on-chain signer`
            : `recovered ${recovered.slice(0, 10)}…${recovered.slice(-6)}, expected ${chainConfig.signer.slice(0, 10)}…${chainConfig.signer.slice(-6)}`,
        },
        {
          name: 'methodology version is accepted on-chain',
          pass: methodologyMatch,
          detail: methodologyMatch
            ? `version ${bytes32ToTrimmedString(att.methodologyVersion)} matches contract`
            : `version ${bytes32ToTrimmedString(att.methodologyVersion)} not currently accepted`,
        },
        {
          name: 'attestation has not expired',
          pass: notExpired,
          detail: notExpired
            ? `valid for ${relativeWindow(att.validUntil)} more`
            : `expired ${relativeWindow(att.validUntil)}`,
        },
        {
          name: 'tier and flags are well-formed',
          pass: tierValid && flagsValid,
          detail: tierValid && flagsValid ? 'in range' : 'out of range',
        },
      ];
      const ok = checks.every((c) => c.pass);

      setResult({
        ok,
        checks,
        recoveredSigner: recovered,
        decoded: {
          tierName: TIER_NAMES[att.tier] ?? `tier#${att.tier}`,
          flagNames: flagsToNames(att.flags),
          chainName: bytes32ToTrimmedString(att.chain),
          methodologyVersionString: bytes32ToTrimmedString(att.methodologyVersion),
          expiresIn: relativeWindow(att.validUntil),
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'verification failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {prefillChain && prefillId && !jsonText && (
        <div className="border border-[var(--color-hairline)] bg-[var(--color-bg-elev)] rounded-[2px] p-4 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-[var(--color-ink)]">
            Pre-fill an attestation for agent <code className="font-mono text-xs">#{prefillId}</code> on{' '}
            <code className="font-mono text-xs">{prefillChain}</code>?
          </p>
          <button onClick={fetchPrefill} disabled={busy} className="aa-btn aa-btn--primary text-sm py-2 disabled:opacity-50">
            {busy ? 'fetching…' : 'fetch latest →'}
          </button>
        </div>
      )}

      <label className="block space-y-2">
        <span className="font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--color-mute)]">
          attestation_json
        </span>
        <textarea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          rows={14}
          spellCheck={false}
          placeholder={'{\n  "attestation": { … },\n  "signature": "0x…"\n}'}
          className="w-full font-mono text-xs leading-relaxed p-3 border border-[var(--color-hairline)] rounded-[2px] bg-white text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-copper)]"
        />
      </label>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={verify}
          disabled={busy || !jsonText.trim() || !chainConfig}
          className="aa-btn aa-btn--primary text-sm py-3 px-5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? 'verifying…' : 'verify ▸'}
        </button>
        <button
          onClick={() => {
            setJsonText('');
            setResult(null);
            setError(null);
          }}
          className="aa-btn aa-btn--ghost text-sm py-3 px-4"
          disabled={busy}
        >
          clear
        </button>
        {chainErr && <span className="font-mono text-xs text-[#B45309]">on-chain config: {chainErr}</span>}
      </div>

      {error && (
        <div className="border border-[#B91C1C]/30 bg-[#FEE2E2] rounded-[2px] px-4 py-3 text-sm text-[#991B1B]">
          <strong>could not verify · </strong>
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div
            className={
              'border rounded-[2px] px-4 py-3 ' +
              (result.ok
                ? 'border-[#00B894]/50 bg-[#E6F7F2] text-[#047857]'
                : 'border-[#F59E0B]/50 bg-[#FEF3E2] text-[#B45309]')
            }
          >
            <p className="font-mono text-sm font-semibold">
              {result.ok ? '✓ valid attestation' : '× verification failed'}
            </p>
            <p className="text-xs mt-1 opacity-90">
              {result.ok
                ? "All four checks passed. A contract calling RatingVerifier.requireMinRating(...) with this attestation would accept it."
                : 'At least one check failed below. The on-chain verifier would revert.'}
            </p>
          </div>

          <div className="border border-[var(--color-hairline)] bg-white rounded-[2px] divide-y divide-[var(--color-hairline)]">
            {result.checks.map((c) => (
              <div key={c.name} className="flex items-start gap-3 px-4 py-3">
                <span
                  className={
                    'font-mono text-sm font-semibold w-4 shrink-0 ' +
                    (c.pass ? 'text-[#047857]' : 'text-[#B45309]')
                  }
                >
                  {c.pass ? '✓' : '×'}
                </span>
                <div className="flex-1">
                  <p className="text-sm text-[var(--color-ink)]">{c.name}</p>
                  {c.detail && <p className="font-mono text-xs text-[var(--color-mute)] mt-0.5">{c.detail}</p>}
                </div>
              </div>
            ))}
          </div>

          {result.decoded && (
            <div className="border border-[var(--color-hairline)] bg-[var(--color-bg-elev)] rounded-[2px] p-4 space-y-1.5">
              <h3 className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-mute)] mb-2">
                //decoded
              </h3>
              <Row k="tier" v={result.decoded.tierName} />
              <Row
                k="flags"
                v={result.decoded.flagNames.length ? result.decoded.flagNames.join(', ') : '(none)'}
              />
              <Row k="chain" v={result.decoded.chainName} />
              <Row k="methodology" v={result.decoded.methodologyVersionString} />
              <Row k="expiry" v={result.decoded.expiresIn} />
              {result.recoveredSigner && (
                <Row k="recovered signer" v={result.recoveredSigner} mono />
              )}
            </div>
          )}

          {result.ok && (
            <p className="text-sm text-[var(--color-mute)]">
              <Link href="/integrate" className="text-[var(--color-copper)] hover:underline">
                see how a contract consumes this attestation →
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 text-sm">
      <span className="font-mono text-xs text-[var(--color-mute)] uppercase tracking-[0.04em]">{k}</span>
      <span className={'text-[var(--color-ink)] break-all ' + (mono ? 'font-mono text-xs' : '')}>{v}</span>
    </div>
  );
}
