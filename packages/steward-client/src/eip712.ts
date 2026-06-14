// @caliber/steward-client — self-contained EIP-712 helpers (viem-only).
//
// This file is a *vendored, minimal* copy of the DeliverySpec / EvidenceAttestation
// typed-data helpers that live in the in-repo @caliber/steward-core package. It is
// inlined here on purpose: the published @caliber/steward-client tarball must
// resolve standalone with NO @caliber/* workspace dependency — only `viem`.
//
// Keep this in sync with packages/steward-core/src/eip712.ts. The typed-data
// tables (field order / types) MUST match the Solidity structs and the server,
// or signatures will not recover. If you change the spec shape in steward-core,
// mirror it here.
//
// Client-side only: Steward owns the checkbook and never signs the spec. These
// helpers let an integrator build + sign a pre-agreed DeliverySpec with THEIR own
// account, and verify the EvidenceAttestation Steward signs back.

import {
  hashTypedData,
  keccak256,
  recoverTypedDataAddress,
  stringToHex,
  type Address,
  type Hex,
  type LocalAccount,
  type TypedDataDomain,
} from 'viem';

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

/** Caliber chain → numeric chainId. */
export const CHAIN_ID: Record<string, number> = {
  arc: 5042002,
  base: 8453,
};

export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/**
 * The shared Caliber EIP-712 domain. Pure — no env reads.
 *
 * @param chain             chain key ("arc") or a raw numeric chainId.
 * @param verifyingContract the EvidenceRegistry address (defaults to the zero
 *        address for off-chain spec signing).
 */
export function caliberDomain(
  chain: string | number,
  verifyingContract: Address = ZERO_ADDRESS,
): TypedDataDomain {
  const chainId =
    typeof chain === 'number' ? chain : (CHAIN_ID[chain] ?? CHAIN_ID.arc);
  return {
    name: 'Caliber',
    version: '1',
    chainId,
    verifyingContract,
  };
}

/** Pack a short ASCII string into a right-padded bytes32 (e.g. "arc"). */
export function stringToBytes32(str: string): Hex {
  const bytes = new TextEncoder().encode(str);
  if (bytes.length > 32) throw new Error(`string too long for bytes32: ${str}`);
  const padded = new Uint8Array(32);
  padded.set(bytes);
  return ('0x' + Buffer.from(padded).toString('hex')) as Hex;
}

// ---------------------------------------------------------------------------
// ConformanceExpect (the Tier-0 expectation descriptor)
// ---------------------------------------------------------------------------

/**
 * What an integrator asks Steward to verify about the delivered response. Every
 * field is optional; an omitted field disables that rule. Mirrors the
 * steward-core ConformanceExpect.
 */
export interface ConformanceExpect {
  /** Require the paid body to parse as JSON. */
  json?: boolean;
  /** Reject bodies larger than this many bytes. */
  maxBytes?: number;
  /** Reject when the round-trip latency exceeded this many milliseconds. */
  deadlineMs?: number;
  /** Treat a JSON body whose `ok === false` (on a 2xx paid response) as a breach. */
  okField?: boolean;
}

// ---------------------------------------------------------------------------
// DeliverySpec
// ---------------------------------------------------------------------------

/**
 * The spec buyer & seller sign BEFORE payment. Field order/types match the
 * Solidity `DeliverySpec` struct exactly.
 */
export const DELIVERY_SPEC_TYPES = {
  DeliverySpec: [
    { name: 'chain', type: 'bytes32' },
    { name: 'buyer', type: 'address' },
    { name: 'seller', type: 'address' },
    { name: 'sellerUrlHash', type: 'bytes32' },
    { name: 'schemaHash', type: 'bytes32' },
    { name: 'maxBytes', type: 'uint32' },
    { name: 'deadlineMs', type: 'uint32' },
    { name: 'requireJson', type: 'bool' },
    { name: 'requireOkField', type: 'bool' },
    { name: 'validUntil', type: 'uint64' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

/** The on-wire DeliverySpec message (viem-typed for signing/hashing). */
export interface DeliverySpec {
  chain: Hex;
  buyer: Address;
  seller: Address;
  sellerUrlHash: Hex;
  schemaHash: Hex;
  maxBytes: number;
  deadlineMs: number;
  requireJson: boolean;
  requireOkField: boolean;
  validUntil: bigint;
  nonce: bigint;
}

/** Loose input callers build a DeliverySpec from. */
export interface DeliverySpecInput {
  /** chain key ("arc") or pre-packed bytes32. Defaults to "arc". */
  chain?: string;
  buyer: Address;
  seller: Address;
  /** Either a raw seller URL (canonicalized + hashed) or a precomputed hash. */
  sellerUrl?: string;
  sellerUrlHash?: Hex;
  /** Either a ConformanceExpect (hashed via schemaHashFromExpect) or a hash. */
  expect?: ConformanceExpect;
  schemaHash?: Hex;
  maxBytes: number;
  deadlineMs: number;
  requireJson: boolean;
  requireOkField: boolean;
  validUntil: number | bigint;
  nonce: number | bigint;
}

/**
 * Canonicalize a seller URL then keccak256 it. Canonical form: lowercase
 * scheme + host, strip a trailing slash from the path, drop the fragment.
 */
export function sellerUrlHash(url: string): Hex {
  let canonical: string;
  try {
    const u = new URL(url.trim());
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    u.hash = '';
    let s = u.toString();
    if (s.endsWith('/') && !/^https?:\/\/[^/]+\/$/i.test(s)) {
      s = s.slice(0, -1);
    }
    canonical = s;
  } catch {
    canonical = url.trim().toLowerCase().replace(/\/+$/, '');
  }
  return keccak256(stringToHex(canonical));
}

/**
 * Derive a stable schemaHash from the ConformanceExpect shape (fixed key order
 * before hashing) so a spec can be built from the same descriptor the
 * conformance check uses.
 */
export function schemaHashFromExpect(expect: ConformanceExpect): Hex {
  const descriptor = JSON.stringify({
    json: expect.json ?? false,
    maxBytes: expect.maxBytes ?? 0,
    deadlineMs: expect.deadlineMs ?? 0,
    okField: expect.okField ?? false,
  });
  return keccak256(stringToHex(descriptor));
}

/** Build a normalized, typed DeliverySpec from loose input. */
export function buildDeliverySpec(input: DeliverySpecInput): DeliverySpec {
  const chain = stringToBytes32(input.chain ?? 'arc');

  let urlHash = input.sellerUrlHash;
  if (!urlHash) {
    if (input.sellerUrl === undefined) {
      throw new Error('buildDeliverySpec: provide sellerUrl or sellerUrlHash');
    }
    urlHash = sellerUrlHash(input.sellerUrl);
  }

  let schemaHash = input.schemaHash;
  if (!schemaHash) {
    if (input.expect === undefined) {
      throw new Error('buildDeliverySpec: provide expect or schemaHash');
    }
    schemaHash = schemaHashFromExpect(input.expect);
  }

  return {
    chain,
    buyer: input.buyer,
    seller: input.seller,
    sellerUrlHash: urlHash,
    schemaHash,
    maxBytes: Number(input.maxBytes),
    deadlineMs: Number(input.deadlineMs),
    requireJson: Boolean(input.requireJson),
    requireOkField: Boolean(input.requireOkField),
    validUntil: BigInt(input.validUntil),
    nonce: BigInt(input.nonce),
  };
}

/** The stable bytes32 handle for a spec = its EIP-712 typed-data hash. */
export function deliverySpecHash(spec: DeliverySpec, domain: TypedDataDomain): Hex {
  return hashTypedData({
    domain,
    types: DELIVERY_SPEC_TYPES,
    primaryType: 'DeliverySpec',
    message: spec,
  });
}

/** Sign a DeliverySpec with a viem LocalAccount. Returns the signature. */
export async function signDeliverySpec(
  spec: DeliverySpec,
  account: LocalAccount,
  domain: TypedDataDomain,
): Promise<Hex> {
  return account.signTypedData({
    domain,
    types: DELIVERY_SPEC_TYPES,
    primaryType: 'DeliverySpec',
    message: spec,
  });
}

/** Recover the address that signed a DeliverySpec. */
export async function recoverDeliverySpecSigner(
  spec: DeliverySpec,
  signature: Hex,
  domain: TypedDataDomain,
): Promise<Address> {
  return recoverTypedDataAddress({
    domain,
    types: DELIVERY_SPEC_TYPES,
    primaryType: 'DeliverySpec',
    message: spec,
    signature,
  });
}

/** True iff `signature` over `spec` recovers to `expectedSigner`. */
export async function verifyDeliverySpecSig(
  spec: DeliverySpec,
  signature: Hex,
  expectedSigner: Address,
  domain: TypedDataDomain,
): Promise<boolean> {
  try {
    const recovered = await recoverDeliverySpecSigner(spec, signature, domain);
    return recovered.toLowerCase() === expectedSigner.toLowerCase();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// EvidenceAttestation (verify side — what Steward signs back on a resolved spec)
// ---------------------------------------------------------------------------

/** Resolved outcome verdict. Matches the Solidity uint8 verdict field. */
export const VERDICT = {
  CONFORMS: 0,
  BREACH: 1,
  INCONCLUSIVE: 2,
} as const;

export type VerdictValue = (typeof VERDICT)[keyof typeof VERDICT];

/**
 * The resolved-outcome attestation Steward signs back. Field order/types match
 * the Solidity `EvidenceAttestation` struct exactly.
 */
export const EVIDENCE_ATTESTATION_TYPES = {
  EvidenceAttestation: [
    { name: 'chain', type: 'bytes32' },
    { name: 'paymentId', type: 'uint256' },
    { name: 'agentId', type: 'uint256' },
    { name: 'specHash', type: 'bytes32' },
    { name: 'responseHash', type: 'bytes32' },
    { name: 'verdict', type: 'uint8' },
    { name: 'verifyingTier', type: 'uint8' },
    { name: 'buyerSig', type: 'bytes32' },
    { name: 'sellerSig', type: 'bytes32' },
    { name: 'methodologyVersion', type: 'bytes32' },
    { name: 'timestamp', type: 'uint64' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

/** The on-wire EvidenceAttestation message (viem-typed). */
export interface EvidenceAttestation {
  chain: Hex;
  paymentId: bigint;
  agentId: bigint;
  specHash: Hex;
  responseHash: Hex;
  verdict: number;
  verifyingTier: number;
  buyerSig: Hex;
  sellerSig: Hex;
  methodologyVersion: Hex;
  timestamp: bigint;
  nonce: bigint;
}

/** The canonical {attestation, signature} pair `verifyEvidence` consumes. */
export interface EvidenceEnvelope {
  attestation: EvidenceAttestation;
  signature: Hex;
}

export interface EvidenceCheck {
  name: string;
  pass: boolean;
  detail?: string;
}

export interface EvidenceVerifyResult {
  valid: boolean;
  recovered: Address | null;
  checks: EvidenceCheck[];
}

/**
 * Verify an EvidenceAttestation envelope off-chain: the signature must recover
 * to `expectedSigner`, and the verdict + verifyingTier must be well-formed. No
 * on-chain reads. `expectedSigner` is the Caliber/Steward signer address (a
 * stable, published key).
 */
export async function verifyEvidence(
  envelope: EvidenceEnvelope,
  opts: { expectedSigner: Address; domain: TypedDataDomain },
): Promise<EvidenceVerifyResult> {
  const att = envelope.attestation;

  let recovered: Address | null = null;
  try {
    recovered = await recoverTypedDataAddress({
      domain: opts.domain,
      types: EVIDENCE_ATTESTATION_TYPES,
      primaryType: 'EvidenceAttestation',
      message: att,
      signature: envelope.signature,
    });
  } catch {
    recovered = null;
  }

  const signerMatch =
    recovered !== null &&
    recovered.toLowerCase() === opts.expectedSigner.toLowerCase();
  const verdictValid = att.verdict >= 0 && att.verdict <= 2;
  const tierValid = att.verifyingTier >= 0 && att.verifyingTier <= 3;

  const checks: EvidenceCheck[] = [
    {
      name: 'signature recovers to the expected signer',
      pass: signerMatch,
      detail: signerMatch
        ? undefined
        : `recovered=${recovered ?? '(none)'}, expected=${opts.expectedSigner}`,
    },
    {
      name: 'verdict is well-formed (0..2)',
      pass: verdictValid,
      detail: verdictValid ? undefined : `verdict=${att.verdict}`,
    },
    {
      name: 'verifyingTier is well-formed (0..3)',
      pass: tierValid,
      detail: tierValid ? undefined : `verifyingTier=${att.verifyingTier}`,
    },
  ];

  return {
    valid: checks.every((c) => c.pass),
    recovered,
    checks,
  };
}
