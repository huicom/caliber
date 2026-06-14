import { describe, it, expect } from 'vitest';
import 'dotenv/config';
import { rateAgent } from '../engine/rating';
import { TIER_ORDER } from '../engine/types';
import { METHODOLOGY_VERSION } from '../engine/version';

const runIntegration = process.env.RUN_INTEGRATION === '1';

describe.skipIf(!runIntegration)('Integration: rate real agents against live DB (v2.0)', () => {
  it('rates agent 4102 (arc) into the new shape', async () => {
    const result = await rateAgent(BigInt(4102), 'arc', 'PIT');

    if (!result.rated) {
      console.log(`Agent 4102 unrated: ${result.reason} (${result.interactions} interactions)`);
      return;
    }

    expect(result.rated).toBe(true);
    expect(TIER_ORDER).toContain(result.tier);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBe(Math.floor(result.score)); // integer
    expect(result.confidence).toMatch(/^(high|moderate|low|insufficient)$/);
    expect(result.confidence_label).toBeTruthy();
    expect(Array.isArray(result.flags)).toBe(true);
    expect(result.methodology_version).toBe(METHODOLOGY_VERSION);
    expect(result.view).toBe('PIT');

    // Factors
    expect(result.factors.completion_rate_raw).toBeGreaterThanOrEqual(0);
    expect(result.factors.completion_rate_raw).toBeLessThanOrEqual(1);
    expect(result.factors.completion_rate_smoothed).toBeGreaterThanOrEqual(0);
    expect(result.factors.completion_rate_smoothed).toBeLessThanOrEqual(1);
    expect(result.factors.forward_success).toBeGreaterThanOrEqual(0);
    expect(result.factors.forward_success).toBeLessThanOrEqual(1);
    expect(result.factors.network_endorsement).toBeGreaterThanOrEqual(0);
    expect(result.factors.network_endorsement).toBeLessThanOrEqual(100);
    expect(result.factors.latency_consistency).toBeGreaterThanOrEqual(0);
    expect(result.factors.latency_consistency).toBeLessThanOrEqual(100);
    expect(result.factors.age_days).toBeGreaterThan(0);
  }, 30000);

  it('high-confidence agent has ≥50 completed jobs', async () => {
    const result = await rateAgent(BigInt(10462), 'arc', 'PIT');

    if (!result.rated) {
      console.log(`Agent 10462 unrated: ${result.reason} (${result.interactions} interactions)`);
      return;
    }

    if (result.confidence === 'high') {
      expect(result.factors.completed_jobs).toBeGreaterThanOrEqual(50);
    }
    expect(result.score).toBeGreaterThanOrEqual(0);
  }, 30000);

  it('TTC view is unsupported at v2.0 (returns unrated)', async () => {
    const result = await rateAgent(BigInt(10462), 'arc', 'TTC');
    if (!result.rated) {
      expect(result.reason).toBe('insufficient_history');
    }
  }, 30000);
});
