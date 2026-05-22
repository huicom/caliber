// @caliber/sdk — TypeScript wrapper around the public Caliber API + the
// on-chain RatingVerifier. Designed for orchestrator stacks, contract
// frontends, and any agent runtime that wants typed access to ratings,
// signed attestations, and recommendation routing.
//
// Quickstart:
//   import { Caliber } from '@caliber/sdk';
//   const c = new Caliber();
//   const rating = await c.rating('arc', '1317');
//   const envelope = await c.attest('arc', '1317', { minTier: 'Proven' });
//   const ok = await c.verifyAttestation(envelope);
//   const match = await c.route({ intent: 'trading bot', min_tier: 'Proven' });

import {
  createPublicClient,
  http,
  recoverTypedDataAddress,
  hexToString,
  type Chain,
} from 'viem';

// =====================================================================
// Types — kept in this file so consumers don't need a deep import
// =====================================================================

export type CaliberTier =
  | 'Established'
  | 'Proven'
  | 'Emerging'
  | 'Provisional'
  | 'Watch'
  | 'Inactive';

export type ConfidenceLabel = 'high' | 'moderate' | 'low' | 'insufficient';

export type RatingFlag =
  | 'CounterpartyConcentration'
  | 'ValidatorConcentration'
  | 'SybilPattern'
  | 'VolumeAnomaly'
  | 'Dormancy';

export const TIER_ORDINAL: Record<CaliberTier, number> = {
  Established: 0,
  Proven: 1,
  Emerging: 2,
  Provisional: 3,
  Watch: 4,
  Inactive: 5,
};

export const FLAG_BIT: Record<RatingFlag, number> = {
  CounterpartyConcentration: 0b00001,
  ValidatorConcentration: 0b00010,
  SybilPattern: 0b00100,
  VolumeAnomaly: 0b01000,
  Dormancy: 0b10000,
};

export interface RatingResponse {
  agent_id: string;
  chain_id: string;
  rated: true;
  tier: CaliberTier;
  score: number;
  confidence: ConfidenceLabel;
  confidence_label: string;
  flags: RatingFlag[];
  interaction_count: number;
  methodology_version: string;
  computed_at: string;
}

export interface UnratedResponse {
  agent_id: string;
  chain_id: string;
  rated: false;
  reason: 'insufficient_interactions' | 'insufficient_history' | 'unknown_identity';
  interactions: number;
  methodology_version: string;
}

export type RatingResult = RatingResponse | UnratedResponse;

export interface AttestationEnvelope {
  attestation: {
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
  };
  signature: `0x${string}`;
  validUntil: number;
  methodologyVersion: string;
  tier: CaliberTier;
  score: number;
  confidence: ConfidenceLabel;
  flags: RatingFlag[];
}

export interface RouteRequest {
  intent: string;
  min_tier?: 'Established' | 'Proven' | 'Emerging' | 'Provisional';
  category?: string;
  blocking_flags?: number;
  chain?: string;
}

export interface RouteResponse {
  chain: string;
  match: {
    agent_id: string;
    name: string;
    owner_address: string;
    tier: CaliberTier;
    category: string | null;
    similarity: number;
    match_reason: string;
    passport_url: string;
  };
  attestation: AttestationEnvelope['attestation'];
  signature: `0x${string}`;
  valid_until: number;
  methodology_version: string;
}

export interface VerifyResult {
  ok: boolean;
  checks: Array<{ name: string; pass: boolean; detail?: string }>;
  recoveredSigner?: `0x${string}`;
}

// =====================================================================
// Defaults — caliber.poko.blue is the canonical Arc Testnet deployment
// =====================================================================

const DEFAULT_API_BASE = 'https://caliber.poko.blue';
const DEFAULT_RATING_API_BASE = 'https://caliber-api.poko.blue';

// Arc Testnet
const DEFAULT_CHAIN: Chain = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } },
  blockExplorers: { default: { name: 'Arcscan', url: 'https://testnet.arcscan.app' } },
  testnet: true,
};

const RATING_VERIFIER_ADDRESS = '0xE3b1e82f1A047BC5B41d8982EaC635EC61526EE8' as const;

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

// =====================================================================
// SDK
// =====================================================================

export interface CaliberOptions {
  /** Web app base URL — `/api/*` endpoints live under here. Default: caliber.poko.blue */
  apiBase?: string;
  /** Rating-service base URL — `/v1/agents/.../attest` lives under here. Default: caliber-api.poko.blue */
  ratingApiBase?: string;
  /** Viem chain to use for on-chain reads. Default: Arc Testnet. */
  chain?: Chain;
  /** RatingVerifier contract address. Default: live Arc Testnet deployment. */
  verifierAddress?: `0x${string}`;
  /** Per-request timeout, ms. Default 10s. */
  timeoutMs?: number;
}

export class Caliber {
  private readonly apiBase: string;
  private readonly ratingApiBase: string;
  private readonly chain: Chain;
  private readonly verifierAddress: `0x${string}`;
  private readonly timeoutMs: number;

  constructor(opts: CaliberOptions = {}) {
    this.apiBase = (opts.apiBase ?? DEFAULT_API_BASE).replace(/\/$/, '');
    this.ratingApiBase = (opts.ratingApiBase ?? DEFAULT_RATING_API_BASE).replace(/\/$/, '');
    this.chain = opts.chain ?? DEFAULT_CHAIN;
    this.verifierAddress = opts.verifierAddress ?? RATING_VERIFIER_ADDRESS;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  // ----- Read endpoints (rating service) -------------------------------

  /** GET /v1/agents/:chain/:id/rating */
  async rating(chain: string, agentId: string | number | bigint): Promise<RatingResult> {
    return this.fetch<RatingResult>(`${this.ratingApiBase}/v1/agents/${chain}/${agentId}/rating`);
  }

  /** GET /v1/ratings/bulk?chain=&ids= */
  async bulkRatings(chain: string, ids: Array<string | number | bigint>) {
    const idStr = ids.map(String).join(',');
    return this.fetch<{ chain: string; count: number; ratings: Array<any> }>(
      `${this.ratingApiBase}/v1/ratings/bulk?chain=${chain}&ids=${idStr}`,
    );
  }

  /** GET /v1/ratings/distribution?chain= */
  async distribution(chain = 'arc') {
    return this.fetch<any>(`${this.ratingApiBase}/v1/ratings/distribution?chain=${chain}`);
  }

  // ----- Write / signed endpoints --------------------------------------

  /** POST /v1/agents/:chain/:id/attest — returns a fresh signed EIP-712 envelope. */
  async attest(
    chain: string,
    agentId: string | number | bigint,
    body: { minTier?: string; minConfidence?: string; validForSeconds?: number } = {},
  ): Promise<AttestationEnvelope> {
    return this.fetch<AttestationEnvelope>(
      `${this.ratingApiBase}/v1/agents/${chain}/${agentId}/attest`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ minTier: 'Inactive', ...body }),
      },
    );
  }

  /** POST /api/v1/route — natural-language agent picker. Returns match + signed attestation. */
  async route(req: RouteRequest): Promise<RouteResponse> {
    return this.fetch<RouteResponse>(`${this.apiBase}/api/v1/route`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
  }

  // ----- Verification --------------------------------------------------

  /**
   * Verify an attestation envelope off-chain. Reads the on-chain signer +
   * methodology versions, recovers the EIP-712 signer locally, checks four
   * conditions the on-chain RatingVerifier.requireMinRating would enforce.
   *
   * Pass the full envelope returned by `attest()` or `route()`.
   */
  async verifyAttestation(envelope: AttestationEnvelope): Promise<VerifyResult> {
    const client = createPublicClient({ chain: this.chain, transport: http() });
    const verifierAbi = [
      { type: 'function', name: 'signer', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
      { type: 'function', name: 'methodologyVersion', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
      { type: 'function', name: 'previousMethodologyVersion', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
    ] as const;

    const [signer, current, previous] = await Promise.all([
      client.readContract({ address: this.verifierAddress, abi: verifierAbi, functionName: 'signer' }),
      client.readContract({ address: this.verifierAddress, abi: verifierAbi, functionName: 'methodologyVersion' }),
      client.readContract({ address: this.verifierAddress, abi: verifierAbi, functionName: 'previousMethodologyVersion' }),
    ]);

    const att = envelope.attestation;
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
        chainId: this.chain.id,
        verifyingContract: this.verifierAddress,
      },
      types: ATTESTATION_TYPES,
      primaryType: 'RatingAttestation',
      message,
      signature: envelope.signature,
    });

    const signerMatch = recovered.toLowerCase() === (signer as string).toLowerCase();
    const methodologyMatch =
      att.methodologyVersion.toLowerCase() === (current as string).toLowerCase() ||
      att.methodologyVersion.toLowerCase() === (previous as string).toLowerCase();
    const notExpired = BigInt(Math.floor(Date.now() / 1000)) <= BigInt(att.validUntil);
    const tierValid = att.tier >= 0 && att.tier <= 5;
    const flagsValid = att.flags >= 0 && att.flags <= 0x1f;

    const checks = [
      {
        name: 'signature recovers to the on-chain signer',
        pass: signerMatch,
        detail: signerMatch ? undefined : `recovered=${recovered}, expected=${signer}`,
      },
      {
        name: 'methodology version is accepted on-chain',
        pass: methodologyMatch,
        detail: methodologyMatch ? `version ${trimBytes32(att.methodologyVersion)}` : 'version not accepted',
      },
      {
        name: 'attestation has not expired',
        pass: notExpired,
      },
      {
        name: 'tier and flags are well-formed',
        pass: tierValid && flagsValid,
      },
    ];

    return {
      ok: checks.every((c) => c.pass),
      checks,
      recoveredSigner: recovered as `0x${string}`,
    };
  }

  // ----- Internals -----------------------------------------------------

  private async fetch<T>(url: string, init: RequestInit = {}): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new CaliberApiError(res.status, url, body.slice(0, 400));
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

export class CaliberApiError extends Error {
  constructor(public status: number, public url: string, public body: string) {
    super(`Caliber API ${status} at ${url}: ${body || '(empty body)'}`);
    this.name = 'CaliberApiError';
  }
}

// ----- Helpers ---------------------------------------------------------

function trimBytes32(hex: `0x${string}`): string {
  try {
    return hexToString(hex, { size: 32 }).replace(/\0+$/, '');
  } catch {
    return hex;
  }
}

export function flagsBitmaskToNames(mask: number): RatingFlag[] {
  return (Object.entries(FLAG_BIT) as Array<[RatingFlag, number]>)
    .filter(([, bit]) => (mask & bit) !== 0)
    .map(([name]) => name);
}
