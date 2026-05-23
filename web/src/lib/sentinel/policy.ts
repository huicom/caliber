// Caliber Sentinel — policy citations for tier_transitions feed.
//
// Each transition row carries the diff (kind, fromFlags→toFlags,
// fromScore→toScore, fromTier→toTier). describePolicy() expresses *why*
// the diff fired, referencing the methodology paper section so the feed
// reads as an audit log of the daily snapshot's decisions, not a list
// of opaque outcomes.

// Bit order matches the on-chain flag bitmask + rating/engine/types.ts
// FLAG_BIT enum. Index in this array = bit position.
const FLAG_NAMES = [
  'CounterpartyConcentration',
  'ValidatorConcentration',
  'SybilPattern',
  'VolumeAnomaly',
  'Dormancy',
] as const;

// Section refs in methodology v2.0 (docs/02-riskmodel/01-Methodology.md).
// Thresholds mirror rating/engine/flags.ts FLAG_THRESHOLDS — keep in sync
// when methodology evolves.
const FLAG_REASONS: Record<(typeof FLAG_NAMES)[number], string> = {
  CounterpartyConcentration:
    '§4.5: top client share > 80% AND < 3 unique clients',
  ValidatorConcentration:
    '§4.5: top validator share > 80% AND < 3 unique validators',
  SybilPattern: '§4.5: self-deal share > 30% AND < 5 unique clients',
  VolumeAnomaly:
    '§4.5: last-30d volume > 10× lifetime rate (≥30d history required)',
  Dormancy: '§4.5: no on-chain activity in ≥90 days',
};

const TIER_GATE_REASONS: Record<string, string> = {
  Established: '§3.4: requires score ≥ 80 AND ≥ 50 interactions',
  Proven: '§3.4: requires score ≥ 65 AND ≥ 20 interactions',
  Emerging: '§3.4: requires score ≥ 50 AND ≥ 5 interactions',
  Provisional: '§3.4: fallback when above tier thresholds not met',
  Watch: '§3.4: any risk flag (except Dormancy) overrides tier to Watch',
  Inactive: '§3.4: Dormancy flag overrides tier to Inactive',
};

function bitsToNames(mask: number | null | undefined): string[] {
  if (mask == null) return [];
  return FLAG_NAMES.filter((_, i) => (mask & (1 << i)) !== 0);
}

export interface TransitionRowLike {
  kind: string;
  from_tier: string | null;
  to_tier: string;
  from_flags: number | null;
  to_flags: number;
  from_score: number | null;
  to_score: number | null;
}

/**
 * Returns a single-line policy citation explaining why this transition
 * fired. Intended to render as a small italicised subtitle under each
 * watchlist row. Returns null when the row is self-explanatory (e.g.
 * first_rating with no surprising signal).
 */
export function describePolicy(row: TransitionRowLike): string | null {
  const added = bitsToNames(row.to_flags & ~(row.from_flags ?? 0));
  const removed = bitsToNames((row.from_flags ?? 0) & ~row.to_flags);

  switch (row.kind) {
    case 'first_rating': {
      // First time the engine published a rating for this agent. The fact
      // that they cleared §1.5 (≥5 interactions, ≥14d history) is itself
      // the policy fact.
      return `§1.5: agent cleared minimum data threshold (≥5 interactions, ≥14d history) → first rating issued at ${row.to_tier}`;
    }

    case 'tier_up':
    case 'tier_down': {
      const direction = row.kind === 'tier_up' ? 'upgraded' : 'downgraded';
      const targetReason = TIER_GATE_REASONS[row.to_tier];
      const scoreDelta =
        row.from_score != null && row.to_score != null
          ? ` (score ${row.from_score} → ${row.to_score})`
          : '';
      const tail = targetReason ? ` ${targetReason}` : '';
      return `${direction} from ${row.from_tier ?? '—'} to ${row.to_tier}${scoreDelta}.${tail}`;
    }

    case 'enter_watch': {
      // Watch is flag-driven. Cite the specific flag(s) that pushed the
      // agent into Watch. If multiple, list them; if none added in this
      // diff (rare, e.g. tier_down + carry-over), fall back to the policy
      // text.
      if (added.length > 0) {
        return added
          .filter((f) => f !== 'Dormancy')
          .map((f) => FLAG_REASONS[f as keyof typeof FLAG_REASONS])
          .join(' · ');
      }
      return TIER_GATE_REASONS.Watch;
    }

    case 'enter_inactive': {
      // Inactive is always Dormancy.
      return FLAG_REASONS.Dormancy;
    }

    case 'exit_watch':
    case 'exit_inactive': {
      const cleared = removed.length > 0 ? removed.join(', ') : 'risk condition';
      return `cleared ${cleared} → rating reissued at ${row.to_tier}`;
    }

    case 'flag_added': {
      if (added.length === 0) return null;
      return added
        .map((f) => `+${f} — ${FLAG_REASONS[f as keyof typeof FLAG_REASONS]}`)
        .join(' · ');
    }

    case 'flag_removed': {
      if (removed.length === 0) return null;
      return removed
        .map((f) => `−${f} — cleared (no longer matches ${FLAG_REASONS[f as keyof typeof FLAG_REASONS]})`)
        .join(' · ');
    }

    default:
      return null;
  }
}
