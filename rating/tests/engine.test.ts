import { describe, it, expect } from 'vitest';
import {
  assignTier,
  confidenceTier,
  MIN_HISTORY_DAYS,
  CONFIDENCE_LOW,
} from '../engine/rating';
import { classifySegment } from '../engine/segment';
import { PD_COEFFICIENTS, isInactiveDefault } from '../engine/pd';
import { LGD_SEGMENT_PRIORS } from '../engine/lgd';
import type { AgentFeatures, AgentSegment } from '../engine/types';

// ============================================================
// Confidence boundaries
// ============================================================
describe('Confidence tier boundaries', () => {
  it('returns null for < 5 interactions', () => {
    expect(confidenceTier(4)).toBeNull();
    expect(confidenceTier(0)).toBeNull();
  });

  it('returns "low" for 5-24 interactions (v1.0.1 tuning)', () => {
    expect(confidenceTier(5)).toBe('low');
    expect(confidenceTier(24)).toBe('low');
  });

  it('returns "medium" for 25-74 interactions (v1.0.1 tuning)', () => {
    expect(confidenceTier(25)).toBe('medium');
    expect(confidenceTier(74)).toBe('medium');
  });

  it('returns "high" for >= 75 interactions (v1.0.1 tuning)', () => {
    expect(confidenceTier(75)).toBe('high');
    expect(confidenceTier(1000)).toBe('high');
  });
});

// ============================================================
// History boundaries
// ============================================================
describe('History boundaries', () => {
  it('MIN_HISTORY_DAYS = 14', () => {
    expect(MIN_HISTORY_DAYS).toBe(14);
  });

  it('CONFIDENCE_LOW = 5', () => {
    expect(CONFIDENCE_LOW).toBe(5);
  });
});

// ============================================================
// Tier boundaries
// ============================================================
describe('Tier boundaries', () => {
  it('Caliber-AAA: PD < 0.004', () => {
    expect(assignTier(0)).toBe('Caliber-AAA');
    expect(assignTier(0.0039)).toBe('Caliber-AAA');
  });

  it('Caliber-AA: 0.004 <= PD < 0.010', () => {
    expect(assignTier(0.004)).toBe('Caliber-AA');
    expect(assignTier(0.0099)).toBe('Caliber-AA');
  });

  it('Caliber-A: 0.010 <= PD < 0.025', () => {
    expect(assignTier(0.010)).toBe('Caliber-A');
    expect(assignTier(0.0249)).toBe('Caliber-A');
  });

  it('Caliber-BBB: 0.025 <= PD < 0.060', () => {
    expect(assignTier(0.025)).toBe('Caliber-BBB');
    expect(assignTier(0.0599)).toBe('Caliber-BBB');
  });

  it('Caliber-BB: 0.060 <= PD < 0.130', () => {
    expect(assignTier(0.06)).toBe('Caliber-BB');
    expect(assignTier(0.1299)).toBe('Caliber-BB');
  });

  it('Caliber-B: 0.130 <= PD < 0.220', () => {
    expect(assignTier(0.13)).toBe('Caliber-B');
    expect(assignTier(0.2199)).toBe('Caliber-B');
  });

  it('Caliber-CCC: 0.220 <= PD < 0.350', () => {
    expect(assignTier(0.22)).toBe('Caliber-CCC');
    expect(assignTier(0.3499)).toBe('Caliber-CCC');
  });

  it('Caliber-CC: 0.350 <= PD < 0.550', () => {
    expect(assignTier(0.35)).toBe('Caliber-CC');
    expect(assignTier(0.5499)).toBe('Caliber-CC');
  });

  it('Caliber-D: PD >= 0.550', () => {
    expect(assignTier(0.55)).toBe('Caliber-D');
    expect(assignTier(0.9999)).toBe('Caliber-D');
    expect(assignTier(1.0)).toBe('Caliber-D');
  });
});

// ============================================================
// LGD segmentation
// ============================================================
describe('LGD segmentation — fallback priors', () => {
  const segments: AgentSegment[] = ['payment-relay', 'trading', 'service', 'validator'];
  const expected: Record<AgentSegment, number> = {
    'payment-relay': 0.1,
    trading: 0.55,
    service: 0.3,
    validator: 0.15,
  };

  for (const seg of segments) {
    it(`${seg} fallback prior = ${expected[seg]}`, () => {
      expect(LGD_SEGMENT_PRIORS[seg]).toBe(expected[seg]);
    });
  }
});

describe('LGD — different segments yield different priors', () => {
  it('payment-relay LGD prior < trading LGD prior', () => {
    expect(LGD_SEGMENT_PRIORS['payment-relay']).toBeLessThan(LGD_SEGMENT_PRIORS['trading']);
  });
  it('validator LGD prior < service LGD prior', () => {
    expect(LGD_SEGMENT_PRIORS['validator']).toBeLessThan(LGD_SEGMENT_PRIORS['service']);
  });
});

// ============================================================
// PD coefficients
// ============================================================
describe('PD coefficients', () => {
  it('has intercept = -3.0 (v1.0.1 tuning, corrected)', () => {
    expect(PD_COEFFICIENTS.intercept).toBe(-3.0);
  });
  it('has all 9 coefficients', () => {
    expect(Object.keys(PD_COEFFICIENTS).length).toBe(9);
  });
});

// ============================================================
// Segmentation heuristic
// ============================================================
describe('Segment classification', () => {
  it('returns explicit agent_type when known', () => {
    expect(classifySegment('payment-relay', null, 0)).toBe('payment-relay');
    expect(classifySegment('trading', null, 0)).toBe('trading');
    expect(classifySegment('service', null, 0)).toBe('service');
    expect(classifySegment('validator', null, 0)).toBe('validator');
  });

  it('infers from capabilities', () => {
    expect(classifySegment(null, ['payment_api'], 0)).toBe('payment-relay');
    expect(classifySegment(null, ['swap_engine'], 0)).toBe('trading');
    expect(classifySegment(null, ['validate_agents'], 0)).toBe('validator');
  });

  it('defaults to service when no hints', () => {
    expect(classifySegment(null, null, 0)).toBe('service');
    expect(classifySegment('unknown', [], 0)).toBe('service');
  });

  it('validator inference from validation count >= 5', () => {
    expect(classifySegment(null, null, 5)).toBe('validator');
    expect(classifySegment(null, null, 4)).toBe('service');
  });
});

// ============================================================
// Inactive default detection
// ============================================================
describe('Inactive default detection', () => {
  it('no events, registered recently — not inactive default', () => {
    const features: AgentFeatures = {
      agentId: 1n,
      chainId: 'arc',
      ownerAddress: '0x1234',
      name: null,
      agentType: null,
      capabilities: null,
      metadata: null,
      registeredAt: new Date(Date.now() - 5 * 86400_000),
      feedbackCount: 0,
      feedbackEvents: [],
      jobs: [],
      validations: [],
      validators: [],
      crossChainChains: ['arc'],
    };
    expect(isInactiveDefault(features)).toBe(false);
  });
});
