import { describe, it, expect } from 'vitest';
import {
  assignTier,
  TIER_GATES,
  HIGH_CONFIDENCE_JOBS,
  MODERATE_CONFIDENCE_JOBS,
  LOW_CONFIDENCE_JOBS,
  MIN_HISTORY_DAYS,
  SCORE_WEIGHTS,
} from '../engine/rating';
import { credibilityBlend, credibilityWeight } from '../engine/credibility';
import { forwardSuccessProbability } from '../engine/survival';
import { computeFlags, FLAG_THRESHOLDS } from '../engine/flags';
import { computeCompletionFeatures } from '../engine/completion-rate';
import { TIER_ORDINAL, flagsToBitfield, FLAG_BIT } from '../engine/types';
import type { AgentFeatures } from '../engine/types';

// ============================================================
// Helpers
// ============================================================

function makeFeatures(overrides: Partial<AgentFeatures> = {}): AgentFeatures {
  const base: AgentFeatures = {
    agentId: 1n,
    chainId: 'arc',
    ownerAddress: '0xagent',
    name: null,
    agentType: null,
    capabilities: null,
    metadata: null,
    registeredAt: new Date(Date.now() - 30 * 86_400_000),
    feedbackCount: 0,
    feedbackEvents: [],
    jobs: [],
    validations: [],
    validators: [],
    crossChainChains: ['arc'],
  };
  return { ...base, ...overrides };
}

function makeJob(
  jobId: bigint,
  status: string,
  daysAgo: number,
  clientAddress = '0xclient',
  budgetUsdc = '100',
): AgentFeatures['jobs'][number] {
  const created = new Date(Date.now() - daysAgo * 86_400_000);
  return {
    jobId,
    status,
    clientAddress,
    budgetUsdc,
    completionReason: null,
    createdAtBlock: 1n,
    completedAtBlock: status === 'Completed' ? 2n : null,
    createdAt: created,
    updatedAt: status === 'Completed' ? new Date(created.getTime() + 86_400_000) : created,
  };
}

// ============================================================
// Methodology constants — locked
// ============================================================

describe('Methodology constants', () => {
  it('MIN_HISTORY_DAYS = 14', () => {
    expect(MIN_HISTORY_DAYS).toBe(14);
  });
  it('HIGH_CONFIDENCE_JOBS = 50', () => {
    expect(HIGH_CONFIDENCE_JOBS).toBe(50);
  });
  it('MODERATE_CONFIDENCE_JOBS = 20', () => {
    expect(MODERATE_CONFIDENCE_JOBS).toBe(20);
  });
  it('LOW_CONFIDENCE_JOBS = 5', () => {
    expect(LOW_CONFIDENCE_JOBS).toBe(5);
  });
  it('SCORE_WEIGHTS sum to 1.0', () => {
    const sum =
      SCORE_WEIGHTS.reliability +
      SCORE_WEIGHTS.forward +
      SCORE_WEIGHTS.network +
      SCORE_WEIGHTS.latency;
    expect(sum).toBeCloseTo(1.0, 5);
  });
});

// ============================================================
// Tier ordinal contract — must match Solidity enum
// ============================================================

describe('Tier ordinal mapping (matches CaliberEscrow enum)', () => {
  it('Established = 0', () => expect(TIER_ORDINAL.Established).toBe(0));
  it('Proven = 1', () => expect(TIER_ORDINAL.Proven).toBe(1));
  it('Emerging = 2', () => expect(TIER_ORDINAL.Emerging).toBe(2));
  it('Provisional = 3', () => expect(TIER_ORDINAL.Provisional).toBe(3));
  it('Watch = 4', () => expect(TIER_ORDINAL.Watch).toBe(4));
  it('Inactive = 5', () => expect(TIER_ORDINAL.Inactive).toBe(5));
});

// ============================================================
// Flag bitfield
// ============================================================

describe('Flag bitfield encoding', () => {
  it('FLAG_BIT values are powers of two', () => {
    expect(FLAG_BIT.CounterpartyConcentration).toBe(1);
    expect(FLAG_BIT.ValidatorConcentration).toBe(2);
    expect(FLAG_BIT.SybilPattern).toBe(4);
    expect(FLAG_BIT.VolumeAnomaly).toBe(8);
    expect(FLAG_BIT.Dormancy).toBe(16);
  });
  it('flagsToBitfield ORs them together', () => {
    expect(flagsToBitfield(['CounterpartyConcentration', 'Dormancy'])).toBe(17);
    expect(flagsToBitfield([])).toBe(0);
    expect(
      flagsToBitfield([
        'CounterpartyConcentration',
        'ValidatorConcentration',
        'SybilPattern',
        'VolumeAnomaly',
        'Dormancy',
      ]),
    ).toBe(31);
  });
});

// ============================================================
// Credibility weighting
// ============================================================

describe('Credibility weighting (§"Smoothing for small samples")', () => {
  it('z = n / (n + k); k=20 default', () => {
    expect(credibilityWeight(0)).toBe(0);
    expect(credibilityWeight(20)).toBeCloseTo(0.5, 5);
    expect(credibilityWeight(100)).toBeCloseTo(100 / 120, 5);
  });
  it('blend pulls sparse data toward population mean', () => {
    // Agent with 4 jobs, all completed (1.0). Population mean 0.95. k=20.
    // z = 4/24 ≈ 0.167. blend ≈ 0.167*1.0 + 0.833*0.95 ≈ 0.958
    const blended = credibilityBlend(1.0, 0.95, 4);
    expect(blended).toBeCloseTo(0.958, 2);
  });
  it('blend lets dense data stand on its own', () => {
    // Agent with 200 jobs, 0.85 rate. Population 0.95. k=20.
    // z = 200/220 ≈ 0.909. blend ≈ 0.909*0.85 + 0.091*0.95 ≈ 0.859
    const blended = credibilityBlend(0.85, 0.95, 200);
    expect(blended).toBeCloseTo(0.859, 2);
  });
  it('zero sample returns population rate', () => {
    expect(credibilityBlend(0.5, 0.95, 0)).toBe(0.95);
  });
});

// ============================================================
// Forward-looking estimate
// ============================================================

describe('Forward success probability (§"Forward-looking estimate")', () => {
  it('no resolved jobs → population rate', () => {
    const f = makeFeatures();
    expect(forwardSuccessProbability(f, 0.9)).toBe(0.9);
  });
  it('all recent successes → ~1.0', () => {
    const f = makeFeatures({
      jobs: [
        makeJob(1n, 'Completed', 1),
        makeJob(2n, 'Completed', 2),
        makeJob(3n, 'Completed', 3),
      ],
    });
    expect(forwardSuccessProbability(f, 0.5)).toBeCloseTo(1.0, 5);
  });
  it('all recent failures → ~0.0', () => {
    const f = makeFeatures({
      jobs: [
        makeJob(1n, 'Rejected', 1),
        makeJob(2n, 'Rejected', 2),
      ],
    });
    expect(forwardSuccessProbability(f, 0.5)).toBeCloseTo(0.0, 5);
  });
  it('weights recent jobs more than old jobs (decay)', () => {
    // 1 recent success + 1 old (180d) failure. With 60d half-life, the old job
    // is worth ~2^(-3) = 0.125. Forward success ≈ 1 / (1 + 0.125) ≈ 0.889.
    const f = makeFeatures({
      jobs: [makeJob(1n, 'Completed', 1), makeJob(2n, 'Rejected', 180)],
    });
    expect(forwardSuccessProbability(f, 0.5)).toBeGreaterThan(0.85);
  });
  it('in-flight jobs are excluded from the rate (censored)', () => {
    // 5 in-flight + 0 resolved → falls back to population rate
    const f = makeFeatures({
      jobs: [
        makeJob(1n, 'Funded', 1),
        makeJob(2n, 'Funded', 2),
        makeJob(3n, 'Submitted', 3),
        makeJob(4n, 'Open', 4),
        makeJob(5n, 'Funded', 5),
      ],
    });
    expect(forwardSuccessProbability(f, 0.95)).toBe(0.95);
  });
});

// ============================================================
// Completion-rate features
// ============================================================

describe('Completion features', () => {
  it('counts completed / disputed / in-flight separately', () => {
    const f = makeFeatures({
      jobs: [
        makeJob(1n, 'Completed', 1),
        makeJob(2n, 'Completed', 2),
        makeJob(3n, 'Rejected', 3),
        makeJob(4n, 'Funded', 4),
      ],
    });
    const c = computeCompletionFeatures(f);
    expect(c.completedJobs).toBe(2);
    expect(c.disputedJobs).toBe(1);
    expect(c.inFlightJobs).toBe(1);
    expect(c.resolvedJobs).toBe(3);
    expect(c.completionRate).toBeCloseTo(2 / 3, 5);
  });
  it('top client share computed correctly', () => {
    const f = makeFeatures({
      jobs: [
        makeJob(1n, 'Completed', 1, '0xA'),
        makeJob(2n, 'Completed', 2, '0xA'),
        makeJob(3n, 'Completed', 3, '0xA'),
        makeJob(4n, 'Completed', 4, '0xB'),
      ],
    });
    const c = computeCompletionFeatures(f);
    expect(c.uniqueClients).toBe(2);
    expect(c.topClientShare).toBeCloseTo(0.75, 5);
  });
  it('active escrow sums only funded/submitted', () => {
    const f = makeFeatures({
      jobs: [
        makeJob(1n, 'Funded', 1, '0xA', '500'),
        makeJob(2n, 'Submitted', 2, '0xA', '300'),
        makeJob(3n, 'Open', 3, '0xA', '200'),       // not funded
        makeJob(4n, 'Completed', 4, '0xA', '1000'), // settled, not in-flight
      ],
    });
    const c = computeCompletionFeatures(f);
    expect(c.activeEscrowUsdc).toBe(800);
  });
});

// ============================================================
// Risk flags
// ============================================================

describe('Risk flags', () => {
  it('CounterpartyConcentration fires when one client has >80% AND <3 unique clients', () => {
    // 5 jobs from 0xA, 1 from 0xB = 83.3% top share, 2 unique clients
    const f = makeFeatures({
      jobs: [
        makeJob(1n, 'Completed', 1, '0xA'),
        makeJob(2n, 'Completed', 2, '0xA'),
        makeJob(3n, 'Completed', 3, '0xA'),
        makeJob(4n, 'Completed', 4, '0xA'),
        makeJob(5n, 'Completed', 5, '0xA'),
        makeJob(6n, 'Completed', 6, '0xB'),
      ],
    });
    const c = computeCompletionFeatures(f);
    const { flags } = computeFlags(f, c);
    expect(flags).toContain('CounterpartyConcentration');
  });
  it('CounterpartyConcentration does NOT fire on the looser-shape pattern (75% top, 2 unique)', () => {
    // The previous (looser) threshold would fire on this; v2.0 launch
    // threshold does not — the flag now requires both >80% top share AND
    // <3 unique clients.
    const f = makeFeatures({
      jobs: [
        makeJob(1n, 'Completed', 1, '0xA'),
        makeJob(2n, 'Completed', 2, '0xA'),
        makeJob(3n, 'Completed', 3, '0xA'),
        makeJob(4n, 'Completed', 4, '0xB'),
      ],
    });
    const c = computeCompletionFeatures(f);
    const { flags } = computeFlags(f, c);
    expect(flags).not.toContain('CounterpartyConcentration');
  });
  it('CounterpartyConcentration does NOT fire when there are 3+ unique clients', () => {
    // 5 jobs from 0xA, 1 from 0xB, 1 from 0xC = 71% top share, 3 unique
    // — fails the <3 unique gate even though top share is high.
    const f = makeFeatures({
      jobs: [
        makeJob(1n, 'Completed', 1, '0xA'),
        makeJob(2n, 'Completed', 2, '0xA'),
        makeJob(3n, 'Completed', 3, '0xA'),
        makeJob(4n, 'Completed', 4, '0xA'),
        makeJob(5n, 'Completed', 5, '0xA'),
        makeJob(6n, 'Completed', 6, '0xB'),
        makeJob(7n, 'Completed', 7, '0xC'),
      ],
    });
    const c = computeCompletionFeatures(f);
    const { flags } = computeFlags(f, c);
    expect(flags).not.toContain('CounterpartyConcentration');
  });
  it('SybilPattern fires when self-deals dominate (>30% share, <5 unique clients)', () => {
    // 3 self-deals + 2 real jobs = 60% self-deal share, 2 unique clients
    const f = makeFeatures({
      ownerAddress: '0xself',
      jobs: [
        makeJob(1n, 'Completed', 1, '0xself'),
        makeJob(2n, 'Completed', 2, '0xself'),
        makeJob(3n, 'Completed', 3, '0xself'),
        makeJob(4n, 'Completed', 4, '0xother'),
        makeJob(5n, 'Completed', 5, '0xother'),
      ],
    });
    const c = computeCompletionFeatures(f);
    const { flags } = computeFlags(f, c);
    expect(flags).toContain('SybilPattern');
  });
  it('SybilPattern does NOT fire on a single self-deal among many real jobs', () => {
    // 1 self-deal + 9 real jobs = 10% self-deal share — below the 30% gate
    const f = makeFeatures({
      ownerAddress: '0xself',
      jobs: [
        makeJob(1n, 'Completed', 1, '0xself'),
        makeJob(2n, 'Completed', 2, '0xA'),
        makeJob(3n, 'Completed', 3, '0xA'),
        makeJob(4n, 'Completed', 4, '0xB'),
        makeJob(5n, 'Completed', 5, '0xB'),
        makeJob(6n, 'Completed', 6, '0xC'),
        makeJob(7n, 'Completed', 7, '0xC'),
        makeJob(8n, 'Completed', 8, '0xD'),
        makeJob(9n, 'Completed', 9, '0xD'),
        makeJob(10n, 'Completed', 10, '0xD'),
      ],
    });
    const c = computeCompletionFeatures(f);
    const { flags } = computeFlags(f, c);
    expect(flags).not.toContain('SybilPattern');
  });
  it('SybilPattern does NOT fire when self-deal share is high but ≥5 unique clients', () => {
    // 4 self-deals + 1 each from 4 distinct clients = 50% self-deal share,
    // but 5 unique clients. The wide client base is evidence the agent is
    // doing real work; self-dealing is part of the operational picture but
    // not the agent's primary business.
    const f = makeFeatures({
      ownerAddress: '0xself',
      jobs: [
        makeJob(1n, 'Completed', 1, '0xself'),
        makeJob(2n, 'Completed', 2, '0xself'),
        makeJob(3n, 'Completed', 3, '0xself'),
        makeJob(4n, 'Completed', 4, '0xself'),
        makeJob(5n, 'Completed', 5, '0xA'),
        makeJob(6n, 'Completed', 6, '0xB'),
        makeJob(7n, 'Completed', 7, '0xC'),
        makeJob(8n, 'Completed', 8, '0xD'),
      ],
    });
    const c = computeCompletionFeatures(f);
    const { flags } = computeFlags(f, c);
    expect(flags).not.toContain('SybilPattern');
  });
  it('Dormancy fires when no activity in 90+ days', () => {
    const f = makeFeatures({
      registeredAt: new Date(Date.now() - 200 * 86_400_000),
      jobs: [makeJob(1n, 'Completed', 100)],
    });
    const c = computeCompletionFeatures(f);
    const { flags } = computeFlags(f, c);
    expect(flags).toContain('Dormancy');
  });
});

// ============================================================
// Tier assignment
// ============================================================

describe('Tier assignment (§Step 3)', () => {
  it('Established needs score >= 80 AND completed >= 50', () => {
    expect(assignTier(85, 100, [])).toBe('Established');
    expect(assignTier(85, 49, [])).toBe('Proven');     // score qualifies for higher, but jobs gate
    expect(assignTier(79, 100, [])).toBe('Proven');    // jobs qualify, score doesn't
  });
  it('Proven needs score >= 65 AND completed >= 20', () => {
    expect(assignTier(70, 25, [])).toBe('Proven');
    expect(assignTier(70, 19, [])).toBe('Emerging');
  });
  it('Emerging needs score >= 50 AND completed >= 5', () => {
    expect(assignTier(55, 10, [])).toBe('Emerging');
    expect(assignTier(55, 4, [])).toBe('Provisional');
  });
  it('Provisional is the floor', () => {
    expect(assignTier(0, 0, [])).toBe('Provisional');
    expect(assignTier(20, 100, [])).toBe('Provisional');
  });
  it('Any non-dormancy flag → Watch (overrides score)', () => {
    expect(assignTier(95, 100, ['CounterpartyConcentration'])).toBe('Watch');
    expect(assignTier(0, 0, ['SybilPattern'])).toBe('Watch');
  });
  it('Dormancy → Inactive (not Watch)', () => {
    expect(assignTier(95, 100, ['Dormancy'])).toBe('Inactive');
    expect(assignTier(0, 0, ['Dormancy', 'CounterpartyConcentration'])).toBe('Inactive');
  });
});

// ============================================================
// Tier gates contract
// ============================================================

describe('Tier gates expose the published thresholds', () => {
  it('Established: floor=80, minJobs=50', () => {
    expect(TIER_GATES.Established.floor).toBe(80);
    expect(TIER_GATES.Established.minJobs).toBe(50);
  });
  it('Proven: floor=65, minJobs=20', () => {
    expect(TIER_GATES.Proven.floor).toBe(65);
    expect(TIER_GATES.Proven.minJobs).toBe(20);
  });
  it('Emerging: floor=50, minJobs=5', () => {
    expect(TIER_GATES.Emerging.floor).toBe(50);
    expect(TIER_GATES.Emerging.minJobs).toBe(5);
  });
});

// ============================================================
// Flag thresholds contract
// ============================================================

describe('Flag thresholds', () => {
  it('Dormancy = 90 days', () => {
    expect(FLAG_THRESHOLDS.DORMANCY_DAYS).toBe(90);
  });
  it('Counterparty: top share > 80% AND < 3 unique clients', () => {
    expect(FLAG_THRESHOLDS.COUNTERPARTY_TOP_SHARE).toBe(0.8);
    expect(FLAG_THRESHOLDS.COUNTERPARTY_MIN_CLIENTS).toBe(3);
  });
  it('Validator: top share > 80% AND < 3 unique validators', () => {
    expect(FLAG_THRESHOLDS.VALIDATOR_TOP_SHARE).toBe(0.8);
    expect(FLAG_THRESHOLDS.VALIDATOR_MIN_VALIDATORS).toBe(3);
  });
  it('Volume anomaly multiplier = 10x', () => {
    expect(FLAG_THRESHOLDS.VOLUME_ANOMALY_MULTIPLIER).toBe(10);
  });
});
