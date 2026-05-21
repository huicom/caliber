import type { AgentSegment, AgentFeatures } from './types';

/** §5.3 — Fallback prior LGD per segment when no observations exist. */
export const LGD_SEGMENT_PRIORS: Record<AgentSegment, number> = {
  'payment-relay': 0.1,
  trading: 0.55,
  service: 0.3,
  validator: 0.15,
};

/**
 * §5.2 — Compute observed LGDs per default event.
 *
 * LGD per default = 1 - (recovered_usdc / ead_at_default).
 *
 * For v1, recovered USDC = job.budget_usdc when status moved to 'Cancelled'
 * or similar recovery event. Since 'Cancelled' isn't in the current schema,
 * we treat all non-Refunded defaults as 0 recovery.
 *
 * TODO: revisit when Cancelled/Refunded job statuses are added to the schema.
 */
function computeObservedLgds(features: AgentFeatures): number[] {
  const lgds: number[] = [];
  const terminalJobs = features.jobs.filter(
    (j) =>
      j.status === 'Completed' ||
      j.status === 'Rejected' ||
      j.status === 'Expired',
  );

  for (const j of terminalJobs) {
    if (j.status !== 'Rejected' && j.status !== 'Expired') continue;
    const ead = j.budgetUsdc ? Number(j.budgetUsdc) : 0;
    if (ead <= 0) continue;

    // §5.2: recovered_usdc = 0 for v1 unless Cancelled/Refunded (not in schema)
    // Per methodology: "document this explicitly"
    const recovered = 0;
    const lgd = 1 - recovered / ead;
    lgds.push(clamp(lgd, 0, 1));
  }
  return lgds;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function computeLGD(
  features: AgentFeatures,
  segment: AgentSegment,
): { lgd: number; lgdDownturn: number; assumptions: string } {
  const observed = computeObservedLgds(features);

  const assumptions =
    'v1 LGD: recovered USDC always 0 for Rejected/Expired jobs. ' +
    'Partial completion recovery not tracked. ' +
    `${segment} segment prior: ${LGD_SEGMENT_PRIORS[segment]}. ` +
    `Observed defaults: ${observed.length}. ` +
    '§4.1b limitation: validations table has no job_id FK, so any FAILED ' +
    'validation in agent history flags ALL terminal jobs as defaulted. ' +
    'May over-state default rate for agents with mixed-quality deliverables.';

  if (observed.length === 0) {
    return {
      lgd: LGD_SEGMENT_PRIORS[segment],
      lgdDownturn: LGD_SEGMENT_PRIORS[segment],
      assumptions,
    };
  }

  const lgd = percentile(observed, 50); // p50
  const lgdDownturn = percentile(observed, 90); // §5.4 downturn LGD
  return { lgd, lgdDownturn, assumptions };
}
