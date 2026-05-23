import type { Request, Response } from 'express';
import { z } from 'zod';
import { db, tierTransitions } from '@arc-agents/db';
import { eq } from 'drizzle-orm';
import { TIER_ORDINAL, type CaliberTier } from '../engine/types';
import { getSigner, stringToBytes32, caliberDomain } from './sign-utils';

/**
 * POST /v1/transitions/:id/attest
 *
 * Caliber Sentinel transition attestation. Looks up the persisted
 * tier_transitions row (produced by the daily snapshot job), builds an
 * EIP-712 TransitionAttestation, signs it with the same signer key that
 * issues rating attestations, and returns the envelope.
 *
 * The same on-chain RatingVerifier signer covers both shapes. A consumer
 * verifies by recovering the typed-data signer and matching it against
 * RatingVerifier.signer() — same trust pattern as rating attestations,
 * different payload shape.
 */
const paramsSchema = z.object({
  id: z.string().regex(/^\d+$/, 'Transition id must be numeric'),
});

const bodySchema = z.object({
  validForSeconds: z.number().int().min(60).max(86_400).optional().default(3600),
});

// Sentinel of "no prior tier" for first_rating events. 0xFF is well outside
// the valid tier ordinal range [0..5], so consumers can detect it cleanly.
const TIER_NONE = 0xff;
const SCORE_NONE = 0xff;

function tierToOrdinal(tier: string | null | undefined): number {
  if (!tier) return TIER_NONE;
  return TIER_ORDINAL[tier as CaliberTier] ?? TIER_NONE;
}

export const TRANSITION_TYPES = {
  TransitionAttestation: [
    { name: 'chain', type: 'bytes32' },
    { name: 'agentId', type: 'uint256' },
    { name: 'fromTier', type: 'uint8' },
    { name: 'toTier', type: 'uint8' },
    { name: 'fromFlags', type: 'uint8' },
    { name: 'toFlags', type: 'uint8' },
    { name: 'kind', type: 'bytes32' },
    { name: 'fromScore', type: 'uint8' },
    { name: 'toScore', type: 'uint8' },
    { name: 'methodologyVersion', type: 'bytes32' },
    { name: 'at', type: 'uint64' },
    { name: 'transitionId', type: 'uint256' },
  ],
} as const;

export async function transitionAttestRoute(req: Request, res: Response): Promise<void> {
  const paramsResult = paramsSchema.safeParse(req.params);
  if (!paramsResult.success) {
    res.status(400).json({
      error: 'invalid_params',
      message: paramsResult.error.issues.map((i) => i.message).join('; '),
    });
    return;
  }

  const bodyResult = bodySchema.safeParse(req.body ?? {});
  if (!bodyResult.success) {
    res.status(400).json({
      error: 'invalid_body',
      message: bodyResult.error.issues.map((i) => i.message).join('; '),
    });
    return;
  }

  const id = BigInt(paramsResult.data.id);

  try {
    const [row] = await db
      .select()
      .from(tierTransitions)
      .where(eq(tierTransitions.id, id))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: 'not_found', message: `Transition #${id} not found` });
      return;
    }

    const chainBytes32 = stringToBytes32(row.chainId);
    const atSeconds = BigInt(Math.floor(new Date(row.at).getTime() / 1000));

    const message = {
      chain: chainBytes32,
      agentId: row.agentId,
      fromTier: tierToOrdinal(row.fromTier),
      toTier: tierToOrdinal(row.toTier),
      fromFlags: row.fromFlags ?? 0,
      toFlags: row.toFlags,
      kind: stringToBytes32(row.kind),
      fromScore: row.fromScore ?? SCORE_NONE,
      toScore: row.toScore ?? SCORE_NONE,
      methodologyVersion: stringToBytes32(row.methodologyVersion),
      at: atSeconds,
      transitionId: row.id,
    };

    const signer = getSigner();
    const domain = caliberDomain(row.chainId);

    const signature = await signer.signTypedData({
      domain,
      types: TRANSITION_TYPES,
      primaryType: 'TransitionAttestation',
      message,
    });

    res.json({
      attestation: {
        ...message,
        agentId: message.agentId.toString(),
        at: message.at.toString(),
        transitionId: message.transitionId.toString(),
      },
      signature,
      methodologyVersion: row.methodologyVersion,
      signedAt: Math.floor(Date.now() / 1000),
      kind: row.kind,
      humanReadable: {
        chain: row.chainId,
        kind: row.kind,
        fromTier: row.fromTier,
        toTier: row.toTier,
        at: row.at,
      },
    });
  } catch (err) {
    console.error('Transition attestation error:', err);
    res.status(500).json({
      error: 'internal_error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}
