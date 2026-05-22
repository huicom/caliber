import type { Request, Response } from 'express';
import { z } from 'zod';
import { rateAgent } from '../engine/rating';
import { METHODOLOGY_VERSION } from '../engine/version';
import { TIER_ORDINAL, flagsToBitfield, type CaliberTier, type ConfidenceLabel } from '../engine/types';
import { db, agents, indexerState } from '@arc-agents/db';
import { eq } from 'drizzle-orm';
import { bytesToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Caliber v2.0 attestation. The on-chain RatingVerifier struct is
// extended with `tier`, `score`, `interactionCount`, `flags` and drops
// `pdBps`, `lgdBps`, `confidence`. This file signs the new struct.
//
// Contract redeploy (Stage C) is required for these signatures to verify.
// Until then the live deployment runs against the v1 contracts with the
// v1 attest endpoint shape — this file is the v2 future state and is
// not yet wired to a deployed verifier.

const CONFIDENCE_ORDINAL: Record<ConfidenceLabel, number> = {
  high: 0,
  moderate: 1,
  low: 2,
  insufficient: 3,
};

const CHAIN_ID_MAP: Record<string, number> = {
  arc: 5042002,
  base: 8453,
};

const paramsSchema = z.object({
  chain: z.string().min(1),
  id: z.string().regex(/^\d+$/, 'Agent ID must be numeric'),
});

const TIER_NAMES = [
  'Established',
  'Proven',
  'Emerging',
  'Provisional',
  'Watch',
  'Inactive',
] as const satisfies readonly CaliberTier[];

const bodySchema = z.object({
  minTier: z.enum(TIER_NAMES).optional().default('Provisional'),
  minConfidence: z.enum(['high', 'moderate', 'low']).optional().default('moderate'),
  validForSeconds: z.number().int().min(60).max(3600).optional().default(600),
});

function stringToBytes32(str: string): `0x${string}` {
  const encoded = new TextEncoder().encode(str);
  const padded = new Uint8Array(32);
  padded.set(encoded.slice(0, 32));
  return bytesToHex(padded);
}

let _signerAccount: ReturnType<typeof privateKeyToAccount> | null = null;
function getSigner() {
  const key = process.env.RATING_SIGNER_PRIVATE_KEY;
  if (!key) throw new Error('RATING_SIGNER_PRIVATE_KEY not set');
  if (!_signerAccount) {
    const pk = (key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`;
    _signerAccount = privateKeyToAccount(pk);
  }
  return _signerAccount;
}

async function getNextNonce(chain: string, agentId: string): Promise<bigint> {
  const key = `attest_nonce:${chain}:${agentId}`;
  const [row] = await db
    .select()
    .from(indexerState)
    .where(eq(indexerState.key, key))
    .limit(1);
  const current = row ? BigInt(row.value) : 0n;
  const next = current + 1n;
  await db
    .insert(indexerState)
    .values({ key, value: next.toString() })
    .onConflictDoUpdate({ target: indexerState.key, set: { value: next.toString() } });
  return next;
}

async function getAgentAddress(chain: string, agentId: bigint): Promise<string> {
  const [row] = await db
    .select({ ownerAddress: agents.ownerAddress })
    .from(agents)
    .where(eq(agents.agentId, agentId))
    .limit(1);
  return row?.ownerAddress ?? '0x0000000000000000000000000000000000000000';
}

/**
 * POST /v1/agents/:chain/:id/attest
 *
 * Caliber v2.0 attestation. Signs an EIP-712 RatingAttestation that the
 * deployed v2 RatingVerifier can verify. Struct:
 *   { chain, agentId, agentAddress, tier, score,
 *     interactionCount, flags, methodologyVersion, asOf, validUntil, nonce }
 */
export async function attestRoute(req: Request, res: Response): Promise<void> {
  const paramsResult = paramsSchema.safeParse(req.params);
  if (!paramsResult.success) {
    res.status(400).json({
      error: 'invalid_params',
      message: paramsResult.error.issues.map((i) => i.message).join('; '),
    });
    return;
  }

  const bodyResult = bodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    res.status(400).json({
      error: 'invalid_body',
      message: bodyResult.error.issues.map((i) => i.message).join('; '),
    });
    return;
  }

  const { chain, id } = paramsResult.data;
  const { minTier, minConfidence, validForSeconds } = bodyResult.data;
  const minTierOrdinal = TIER_ORDINAL[minTier];
  const minConfOrdinal = CONFIDENCE_ORDINAL[minConfidence];

  try {
    const agentId = BigInt(id);
    const result = await rateAgent(agentId, chain);

    if (!result.rated) {
      res.status(422).json({
        rated: false,
        reason: result.reason,
        detail: `Agent ${id} on ${chain} cannot be rated: ${result.reason} (${result.interactions} interactions)`,
      });
      return;
    }

    if (TIER_ORDINAL[result.tier] > minTierOrdinal) {
      res.status(422).json({
        rated: true,
        tier: result.tier,
        confidence: result.confidence,
        reason: 'rating_below_threshold',
        detail: `Agent tier ${result.tier} does not meet minimum ${minTier}`,
      });
      return;
    }

    if (CONFIDENCE_ORDINAL[result.confidence] > minConfOrdinal) {
      res.status(422).json({
        rated: true,
        tier: result.tier,
        confidence: result.confidence,
        reason: 'confidence_below_threshold',
        detail: `Agent confidence ${result.confidence} does not meet minimum ${minConfidence}`,
      });
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const validUntil = now + validForSeconds;
    const nonce = await getNextNonce(chain, id);
    const agentAddress = await getAgentAddress(chain, agentId);

    // Defensive: empty/zero ownerAddress would crash viem.signTypedData with
    // an opaque "Address is invalid" error. Engine usually guards via
    // unknown_identity, but check here too so the form sees a real message.
    if (
      !agentAddress ||
      agentAddress === '' ||
      agentAddress === '0x0000000000000000000000000000000000000000'
    ) {
      res.status(422).json({
        rated: true,
        tier: result.tier,
        confidence: result.confidence,
        reason: 'unknown_identity',
        detail: `Agent ${id} on ${chain} has aggregate stats but no verified on-chain owner address. Cannot issue an attestation.`,
      });
      return;
    }

    const chainBytes32 = stringToBytes32(chain);

    const attestation = {
      chain: chainBytes32,
      agentId,
      agentAddress: agentAddress as `0x${string}`,
      tier: TIER_ORDINAL[result.tier],
      score: result.score,
      interactionCount: Math.min(result.interaction_count, 65535),
      flags: flagsToBitfield(result.flags),
      methodologyVersion: stringToBytes32(METHODOLOGY_VERSION),
      asOf: BigInt(now),
      validUntil: BigInt(validUntil),
      nonce,
    };

    const signer = getSigner();
    const verifyingContract = (process.env.RATING_VERIFIER_ADDRESS ||
      '0x0000000000000000000000000000000000000000') as `0x${string}`;
    const chainId = CHAIN_ID_MAP[chain] ?? 5042002;

    // EIP-712 domain — `name="Caliber"` matches the on-chain RatingVerifier.
    const domain = {
      name: 'Caliber',
      version: '1',
      chainId,
      verifyingContract,
    };

    const types = {
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
    };

    const signature = await signer.signTypedData({
      domain,
      types,
      primaryType: 'RatingAttestation',
      message: attestation,
    });

    res.json({
      attestation: {
        ...attestation,
        agentId: attestation.agentId.toString(),
        asOf: attestation.asOf.toString(),
        validUntil: attestation.validUntil.toString(),
        nonce: attestation.nonce.toString(),
      },
      signature,
      validUntil,
      methodologyVersion: METHODOLOGY_VERSION,
      tier: result.tier,
      score: result.score,
      confidence: result.confidence,
      flags: result.flags,
    });
  } catch (err) {
    console.error('Attestation error:', err);
    res.status(500).json({
      error: 'internal_error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}
