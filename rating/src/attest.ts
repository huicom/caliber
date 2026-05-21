import type { Request, Response } from 'express';
import { z } from 'zod';
import { rateAgent } from '../engine/rating';
import { METHODOLOGY_VERSION } from '../engine/version';
import { db, agents, indexerState } from '@arc-agents/db';
import { eq } from 'drizzle-orm';
import { bytesToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const TIER_MAP: Record<string, number> = {
  'Caliber-AAA': 0,
  'Caliber-AA': 1,
  'Caliber-A': 2,
  'Caliber-BBB': 3,
  'Caliber-BB': 4,
  'Caliber-B': 5,
  'Caliber-CCC': 6,
  'Caliber-CC': 7,
  'Caliber-D': 8,
};

const CONFIDENCE_MAP: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const CHAIN_ID_MAP: Record<string, number> = {
  arc: 5042002,
  base: 8453,
};

const paramsSchema = z.object({
  chain: z.string().min(1),
  id: z.string().regex(/^\d+$/, 'Agent ID must be numeric'),
});

const bodySchema = z.object({
  minTier: z
    .enum([
      'Caliber-AAA', 'Caliber-AA', 'Caliber-A',
      'Caliber-BBB', 'Caliber-BB', 'Caliber-B',
      'Caliber-CCC', 'Caliber-CC', 'Caliber-D',
    ])
    .optional()
    .default('Caliber-D'),
  minConfidence: z.enum(['high', 'medium', 'low']).optional().default('medium'),
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
 * Signs an EIP-712 RatingAttestation the on-chain RatingVerifier can verify.
 * Domain `name="Caliber"` matches the redeployed verifier contract.
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
  const minTierNum = TIER_MAP[minTier] ?? 8;
  const minConfNum = CONFIDENCE_MAP[minConfidence] ?? 2;

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

    if ((TIER_MAP[result.rating] ?? 8) > minTierNum) {
      res.status(422).json({
        rated: true,
        rating: result.rating,
        confidence: result.confidence,
        reason: 'rating_below_threshold',
        detail: `Agent rating ${result.rating} does not meet minimum ${minTier}`,
      });
      return;
    }

    if ((CONFIDENCE_MAP[result.confidence] ?? 2) > minConfNum) {
      res.status(422).json({
        rated: true,
        rating: result.rating,
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
        rating: result.rating,
        confidence: result.confidence,
        reason: 'unknown_identity',
        detail: `Agent ${id} on ${chain} has aggregate stats but no verified on-chain owner address. Cannot issue an attestation.`,
      });
      return;
    }

    const chainBytes32 = stringToBytes32(chain);

    const attestation = {
      chain: chainBytes32,
      agentId: agentId,
      agentAddress: agentAddress as `0x${string}`,
      tier: TIER_MAP[result.rating] ?? 8,
      pdBps: Math.round(result.ppd_30d * 10000),
      // Wave 2: lgdBps signed in the attestation so CaliberEscrow can price
      // bond = budget × pd × lgd from this single signed payload.
      lgdBps: Math.round(result.lgd * 10000),
      confidence: CONFIDENCE_MAP[result.confidence] ?? 2,
      methodologyVersion: stringToBytes32(METHODOLOGY_VERSION),
      asOf: BigInt(now),
      validUntil: BigInt(validUntil),
      nonce,
    };

    const signer = getSigner();
    const verifyingContract = (process.env.RATING_VERIFIER_ADDRESS ||
      '0x0000000000000000000000000000000000000000') as `0x${string}`;
    const chainId = CHAIN_ID_MAP[chain] ?? 5042002;

    // EIP-712 domain — `name="Caliber"` matches the on-chain RatingVerifier
    // redeployed 2026-05-21 with `EIP712("Caliber", "1")` in the constructor.
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
        { name: 'pdBps', type: 'uint16' },
        { name: 'lgdBps', type: 'uint16' },
        { name: 'confidence', type: 'uint8' },
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

    // Express's res.json() routes through JSON.stringify, which can't
    // serialize BigInts. Convert all uint-typed fields to strings on the
    // wire (the client re-wraps with BigInt() before signing/sending).
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
    });
  } catch (err) {
    console.error('Attestation error:', err);
    res.status(500).json({
      error: 'internal_error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}
