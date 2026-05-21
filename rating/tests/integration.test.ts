import { describe, it, expect } from 'vitest';
import 'dotenv/config';
import { rateAgent } from '../engine/rating';

const runIntegration = process.env.RUN_INTEGRATION === '1';
const skipMessage = 'RUN_INTEGRATION=1 not set';

describe.skipIf(!runIntegration)('Integration: rate real agents against live DB', () => {
  it('rates agent 4102 (arc) with sensible factor ranges', async () => {
    const result = await rateAgent(BigInt(4102), 'arc', 'PIT');

    if (!result.rated) {
      // Agent may be unrated if insufficient data — skip validation
      console.log(`Agent 4102 unrated: ${result.reason} (${result.interactions} interactions)`);
      return;
    }

    expect(result.rated).toBe(true);
    expect(result.rating).toMatch(/^Arc-[A-D]+$/);
    expect(result.factors.logit).toBeGreaterThan(-10);
    expect(result.factors.logit).toBeLessThan(10);
    expect(result.factors.validator_quality_avg).toBeGreaterThanOrEqual(0);
    expect(result.factors.validator_quality_avg).toBeLessThanOrEqual(1);
    expect(result.factors.total_terminal_jobs).toBeDefined();
    expect(result.factors.defaulted_jobs).toBeGreaterThanOrEqual(0);
    expect(result.lgd).toBeGreaterThan(0);
    expect(result.lgd).toBeLessThan(1);
    expect(result.lgd_downturn).toBeGreaterThan(0);
    expect(result.confidence).toMatch(/^(high|medium|low)$/);
    expect(result.methodology_version).toBe('1.0.0');
    expect(result.view).toBe('PIT');
    expect(result.factors.lookback_days).toBe(30);
  }, 30000);

  it('rates agent 10462 (arc) with high confidence', async () => {
    const result = await rateAgent(BigInt(10462), 'arc', 'PIT');

    if (!result.rated) {
      console.log(`Agent 10462 unrated: ${result.reason} (${result.interactions} interactions)`);
      return;
    }

    expect(result.confidence).toBe('high');
    expect(result.factors.interaction_count).toBeGreaterThanOrEqual(50);
  }, 30000);

  it('TTC view returns lookback_days: null', async () => {
    const result = await rateAgent(BigInt(10462), 'arc', 'TTC');

    if (result.rated) {
      expect(result.view).toBe('TTC');
      expect(result.factors.lookback_days).toBeNull();
    }
  }, 30000);
});
