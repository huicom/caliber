// Steward EIP-712 — shared typed-data for the signed-spec pay path and
// evidence attestations (Phase 2, WS-0).
//
// Two structs share ONE EIP-712 domain (name "Caliber", version "1") so the
// whole Steward surface anchors to a single trust root — the same domain the
// rating attestations use (see rating/src/sign-utils.ts `caliberDomain`). The
// only difference here: `caliberDomain` is a PURE function taking chainId +
// optional verifyingContract (the EvidenceRegistry address, supplied by the
// caller — services/contracts are later workstreams), with no env reads.
//
// 1. DeliverySpec        — buyer & seller sign this BEFORE payment. It pins
//    exactly what the seller must deliver (URL, schema, size/deadline budget,
//    JSON/ok-field requirements) so a breach is provable later.
// 2. EvidenceAttestation — the Steward signer writes this AFTER the outcome is
//    resolved, committing the verdict + a commitment to both spec signatures.
//
// Field order / types in the typed-data tables below MUST match the Solidity
// structs exactly (a parallel agent writes EvidenceRegistry.sol against these).
//
// Framework-free: no Express, no DB, no env. Account input is a viem
// `LocalAccount` (callers pass `privateKeyToAccount(...)`).

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
import type { ConformanceExpect } from './conformance.js';

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

/** Caliber chain → numeric chainId. Mirrors rating CHAIN_ID_MAP. */
export const CHAIN_ID: Record<string, number> = {
  arc: 5042002,
  base: 8453,
};

export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/**
 * The shared Caliber EIP-712 domain. Pure — no env reads.
 *
 * @param chain            chain key ("arc") or a raw numeric chainId.
 * @param verifyingContract the EvidenceRegistry address (defaults to the zero
 *        address until the contract is deployed in a later workstream).
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
// DeliverySpec
// ---------------------------------------------------------------------------

/**
 * The spec buyer & seller sign BEFORE payment. Field order/types match the
 * Solidity `DeliverySpec` struct exactly:
 *   bytes32 chain; address buyer; address seller; bytes32 sellerUrlHash;
 *   bytes32 schemaHash; uint32 maxBytes; uint32 deadlineMs; bool requireJson;
 *   bool requireOkField; uint64 validUntil; uint256 nonce;
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

/** Loose input shape callers build a DeliverySpec from. */
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
 * Falls back to a lowercased trimmed string if the URL doesn't parse.
 */
export function sellerUrlHash(url: string): Hex {
  let canonical: string;
  try {
    const u = new URL(url.trim());
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    u.hash = '';
    let s = u.toString();
    // strip a single trailing slash on the path (but keep "https://host/")
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
 * Derive a stable schemaHash from the existing ConformanceExpect shape so a
 * spec can be built from the same descriptor the conformance check uses. The
 * descriptor is serialized in a fixed key order before hashing.
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

/**
 * The stable bytes32 handle for a spec = the EIP-712 typed-data hash. This is
 * the `specHash` later embedded in the EvidenceAttestation and (in a later
 * workstream) recorded on-chain.
 */
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
// EvidenceAttestation
// ---------------------------------------------------------------------------

/** Resolved outcome verdict. Matches the Solidity uint8 verdict field. */
export const VERDICT = {
  CONFORMS: 0,
  BREACH: 1,
  INCONCLUSIVE: 2,
} as const;

export type VerdictValue = (typeof VERDICT)[keyof typeof VERDICT];

/**
 * The resolved-outcome attestation written back to Caliber. Field order/types
 * match the Solidity `EvidenceAttestation` struct exactly:
 *   bytes32 chain; uint256 paymentId; uint256 agentId; bytes32 specHash;
 *   bytes32 responseHash; uint8 verdict; uint8 verifyingTier; bytes32 buyerSig;
 *   bytes32 sellerSig; bytes32 methodologyVersion; uint64 timestamp;
 *   uint256 nonce;
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

/** Loose input for building an EvidenceAttestation. */
export interface EvidenceAttestationInput {
  /** chain key ("arc") or pre-packed bytes32. Defaults to "arc". */
  chain?: string;
  paymentId: number | bigint;
  agentId: number | bigint;
  specHash: Hex;
  /** sha256 of the delivered bytes (hex), computed by the caller. */
  responseHash: Hex;
  verdict: VerdictValue | number;
  /** 0..3 — which Tier of judge resolved the verdict. */
  verifyingTier: number;
  /**
   * Commitments to the spec signatures. Either pass the raw buyer/seller spec
   * signatures (keccak256'd here) or pass precomputed bytes32 commitments.
   */
  buyerSpecSignature?: Hex;
  sellerSpecSignature?: Hex;
  buyerSig?: Hex;
  sellerSig?: Hex;
  /** Methodology version string ("2.0.1") or a pre-packed bytes32. */
  methodologyVersion: string;
  /** unix seconds; defaults to now. */
  timestamp?: number | bigint;
  nonce: number | bigint;
}

/**
 * The envelope returned by `signEvidenceAttestation` and consumed by
 * `verifyEvidence` — the canonical {attestation, signature} pair.
 */
export interface EvidenceEnvelope {
  attestation: EvidenceAttestation;
  signature: Hex;
}

const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;

/** keccak256 a signature into a bytes32 commitment. */
function sigCommitment(sig: Hex): Hex {
  return keccak256(sig);
}

/** Build a normalized, typed EvidenceAttestation from loose input. */
export function buildEvidenceAttestation(
  input: EvidenceAttestationInput,
): EvidenceAttestation {
  const chain = stringToBytes32(input.chain ?? 'arc');

  let buyerSig = input.buyerSig;
  if (!buyerSig) {
    if (input.buyerSpecSignature === undefined) {
      throw new Error(
        'buildEvidenceAttestation: provide buyerSpecSignature or buyerSig',
      );
    }
    buyerSig = sigCommitment(input.buyerSpecSignature);
  }

  let sellerSig = input.sellerSig;
  if (!sellerSig) {
    if (input.sellerSpecSignature === undefined) {
      throw new Error(
        'buildEvidenceAttestation: provide sellerSpecSignature or sellerSig',
      );
    }
    sellerSig = sigCommitment(input.sellerSpecSignature);
  }

  const methodologyVersion = BYTES32_RE.test(input.methodologyVersion)
    ? (input.methodologyVersion as Hex)
    : stringToBytes32(input.methodologyVersion);

  const timestamp =
    input.timestamp === undefined
      ? BigInt(Math.floor(Date.now() / 1000))
      : BigInt(input.timestamp);

  return {
    chain,
    paymentId: BigInt(input.paymentId),
    agentId: BigInt(input.agentId),
    specHash: input.specHash,
    responseHash: input.responseHash,
    verdict: Number(input.verdict),
    verifyingTier: Number(input.verifyingTier),
    buyerSig,
    sellerSig,
    methodologyVersion,
    timestamp,
    nonce: BigInt(input.nonce),
  };
}

/**
 * Sign an EvidenceAttestation with a viem LocalAccount. Returns the canonical
 * {attestation, signature} envelope (mirrors rating/src/attest.ts).
 */
export async function signEvidenceAttestation(
  att: EvidenceAttestation,
  account: LocalAccount,
  domain: TypedDataDomain,
): Promise<EvidenceEnvelope> {
  const signature = await account.signTypedData({
    domain,
    types: EVIDENCE_ATTESTATION_TYPES,
    primaryType: 'EvidenceAttestation',
    message: att,
  });
  return { attestation: att, signature };
}

/** The bytes32 typed-data hash of an EvidenceAttestation. */
export function evidenceAttestationHash(
  att: EvidenceAttestation,
  domain: TypedDataDomain,
): Hex {
  return hashTypedData({
    domain,
    types: EVIDENCE_ATTESTATION_TYPES,
    primaryType: 'EvidenceAttestation',
    message: att,
  });
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
 * Verify an EvidenceAttestation envelope off-chain (mirrors the SDK
 * `verifyAttestation`): the signature must recover to `expectedSigner`, and the
 * verdict + verifyingTier must be well-formed. No on-chain reads — the
 * EvidenceRegistry contract lands in a later workstream.
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
