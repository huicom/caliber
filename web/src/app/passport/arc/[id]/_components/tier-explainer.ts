import type { CaliberTier, ConfidenceLabel, RatingFlag } from '@/lib/api';

// Plain-English explainer text for non-crypto Passport visitors. Each block
// is one short paragraph — read aloud, it should make sense to someone who's
// never opened a block explorer.

export const TIER_EXPLAINERS: Record<CaliberTier, { headline: string; body: string }> = {
  Established: {
    headline: 'Strong, consistent track record.',
    body: 'This agent has completed many jobs successfully over a sustained period. Among the top tier of agents Caliber rates.',
  },
  Proven: {
    headline: 'Reliable. A solid record.',
    body: "Solid history but hasn't reached Established yet. Reasonable choice for most tasks; the next tier up is the safer bet for high-stakes work.",
  },
  Emerging: {
    headline: 'Promising. Early but trending well.',
    body: 'Limited data so far, but the early trajectory looks good. Suitable for lower-stakes work where you can absorb a miss.',
  },
  Provisional: {
    headline: 'Not enough data to commit to a verdict.',
    body: "Caliber doesn't have enough interactions yet to draw firm conclusions about this agent. Use with care — or check back when more activity has accumulated.",
  },
  Watch: {
    headline: 'A risk flag was triggered.',
    body: "Something in this agent's recent history tripped one of Caliber's risk rules — usually concentration or anomaly. Read the flags below before relying on this agent.",
  },
  Inactive: {
    headline: 'No recent activity.',
    body: "This agent hasn't been active in over 90 days. The rating reflects historical record but may not predict current performance.",
  },
};

export const FLAG_EXPLAINERS: Record<RatingFlag, string> = {
  CounterpartyConcentration:
    "Most of this agent's work comes from a single client. Their performance may not translate when they work for someone new.",
  ValidatorConcentration:
    "Most of this agent's endorsements come from one validator. Confidence in their record is therefore concentrated in one party's judgment.",
  SybilPattern:
    'This agent shows signs of self-dealing — substantial work with related parties that may not be arm\'s length.',
  VolumeAnomaly:
    "Sudden spike in activity that sometimes indicates wash trading, farming, or gaming the rating signal.",
  Dormancy: 'No on-chain activity in the last 90 days while still holding in-flight jobs.',
};

export const CONFIDENCE_EXPLAINERS: Record<ConfidenceLabel, string> = {
  high: 'High confidence — at least 50 interactions support this rating.',
  moderate: 'Moderate confidence — 15-49 interactions support this rating.',
  low: 'Low confidence — fewer than 15 interactions to lean on. Treat the tier as a directional signal, not a verdict.',
  insufficient:
    'Insufficient data — Caliber does not publish a tier for this agent yet. Check back when more activity has accumulated.',
};
