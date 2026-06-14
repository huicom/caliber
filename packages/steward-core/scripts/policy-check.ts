// Unit-style assertions for the compiled-policy evaluator (Steward task 13).
//
//   tsx scripts/policy-check.ts
//
// No test framework — a tiny assert helper, exit 1 on the first failure. Covers:
// per-tx cap, daily-cap accumulation, allowedHosts suffix matching, denial
// precedence, approval threshold → hold, plus the schema parse/DEFAULT_POLICY.

import {
  evaluatePolicy,
  parseCompiledPolicy,
  DEFAULT_POLICY,
  type CompiledPolicy,
  type PolicyContext,
  type PolicyVerdict,
} from '../src/policy.js';
import { checkRunawayLoop } from '../src/detectors/runaway-loop.js';
import { checkPriceSpike } from '../src/detectors/price-spike.js';

let passed = 0;
const failures: string[] = [];

function check(label: string, cond: boolean): void {
  if (cond) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}`);
  }
}

function expectOk(label: string, v: PolicyVerdict): void {
  check(label, v.ok === true);
}
function expectDeny(label: string, v: PolicyVerdict, rule?: string): void {
  check(
    label,
    v.ok === false && v.action === 'deny' && (rule === undefined || v.rule === rule),
  );
  if (v.ok === false && rule && v.rule !== rule) {
    console.log(`       (got rule '${v.rule}', wanted '${rule}': ${v.detail})`);
  }
}
function expectHold(label: string, v: PolicyVerdict, rule?: string): void {
  check(
    label,
    v.ok === false && v.action === 'hold' && (rule === undefined || v.rule === rule),
  );
  if (v.ok === false && rule && v.rule !== rule) {
    console.log(`       (got rule '${v.rule}', wanted '${rule}': ${v.detail})`);
  }
}

const baseCtx: PolicyContext = {
  todaySpentUsdc: '0',
  isNewCounterparty: false,
};

const basePolicy: CompiledPolicy = {
  version: 1,
  caps: { perTxUsdc: '0.005', dailyUsdc: '0.50' },
  newCounterparty: 'allow',
};

console.log('\n# schema + defaults');
{
  const parsed = parseCompiledPolicy(DEFAULT_POLICY);
  check('DEFAULT_POLICY round-trips through the schema', parsed.caps.perTxUsdc === '0.005');
  check('DEFAULT_POLICY daily is 0.50', DEFAULT_POLICY.caps.dailyUsdc === '0.50');
  check('DEFAULT_POLICY newCounterparty is hold (first-payment approval)', DEFAULT_POLICY.newCounterparty === 'hold');

  let threw = false;
  try {
    parseCompiledPolicy({ version: 1, caps: { perTxUsdc: 'NaN', dailyUsdc: '0.5' }, newCounterparty: 'allow' });
  } catch {
    threw = true;
  }
  check('schema rejects a non-decimal USDC string', threw);

  let threwUnknown = false;
  try {
    parseCompiledPolicy({ ...DEFAULT_POLICY, surprise: true });
  } catch {
    threwUnknown = true;
  }
  check('schema rejects unknown keys (strict)', threwUnknown);
}

console.log('\n# per-tx cap');
{
  expectOk('at the cap passes', evaluatePolicy({ host: 'a.com', payToUsdc: '0.005' }, baseCtx, basePolicy));
  expectDeny(
    'above the cap denies',
    evaluatePolicy({ host: 'a.com', payToUsdc: '0.006' }, baseCtx, basePolicy),
    'per_tx_cap',
  );
}

console.log('\n# daily cap accumulation');
{
  // already spent 0.498 today; a 0.005 payment would hit 0.503 > 0.50.
  expectDeny(
    'accumulated spend over daily cap denies',
    evaluatePolicy(
      { host: 'a.com', payToUsdc: '0.005' },
      { ...baseCtx, todaySpentUsdc: '0.498' },
      basePolicy,
    ),
    'daily_cap',
  );
  // 0.495 + 0.005 = 0.50 exactly → still allowed (cap is inclusive).
  expectOk(
    'spend landing exactly on the daily cap passes',
    evaluatePolicy(
      { host: 'a.com', payToUsdc: '0.005' },
      { ...baseCtx, todaySpentUsdc: '0.495' },
      basePolicy,
    ),
  );
}

console.log('\n# per-counterparty daily cap');
{
  const p: CompiledPolicy = {
    ...basePolicy,
    caps: { perTxUsdc: '0.005', dailyUsdc: '0.50', perCounterpartyDailyUsdc: '0.002' },
  };
  expectDeny(
    'per-counterparty daily cap denies',
    evaluatePolicy(
      { host: 'a.com', payToUsdc: '0.002' },
      { ...baseCtx, counterpartyTodayUsdc: '0.001' },
      p,
    ),
    'per_counterparty_daily_cap',
  );
}

console.log('\n# allowedHosts suffix matching');
{
  const p: CompiledPolicy = { ...basePolicy, allowedHosts: ['poko.blue'] };
  expectOk(
    'exact host match passes',
    evaluatePolicy({ host: 'poko.blue', payToUsdc: '0.001' }, baseCtx, p),
  );
  expectOk(
    'subdomain suffix match passes',
    evaluatePolicy({ host: 'api.poko.blue', payToUsdc: '0.001' }, baseCtx, p),
  );
  expectDeny(
    'non-suffix lookalike denies',
    evaluatePolicy({ host: 'evilpoko.blue', payToUsdc: '0.001' }, baseCtx, p),
    'host_not_allowed',
  );
  expectDeny(
    'unrelated host denies',
    evaluatePolicy({ host: 'example.com', payToUsdc: '0.001' }, baseCtx, p),
    'host_not_allowed',
  );
}

console.log('\n# denial precedence');
{
  // deniedHosts beats allowedHosts even when the host is on both.
  const p: CompiledPolicy = {
    ...basePolicy,
    allowedHosts: ['poko.blue'],
    deniedHosts: ['bad.poko.blue'],
  };
  expectDeny(
    'deniedHosts beats allowedHosts',
    evaluatePolicy({ host: 'bad.poko.blue', payToUsdc: '0.001' }, baseCtx, p),
    'denied_host',
  );

  // a hard deny (over per-tx cap) wins over a would-be approval hold.
  const p2: CompiledPolicy = { ...basePolicy, approvalThresholdUsdc: '0.001' };
  expectDeny(
    'per-tx cap (deny) wins over approval threshold (hold)',
    evaluatePolicy({ host: 'a.com', payToUsdc: '0.01' }, baseCtx, p2),
    'per_tx_cap',
  );
}

console.log('\n# minCaliberScore (only when score present)');
{
  const p: CompiledPolicy = { ...basePolicy, minCaliberScore: 75 };
  expectOk(
    'no score in context → not enforced',
    evaluatePolicy({ host: 'a.com', payToUsdc: '0.001' }, baseCtx, p),
  );
  expectDeny(
    'score below minimum denies',
    evaluatePolicy({ host: 'a.com', payToUsdc: '0.001' }, { ...baseCtx, caliberScore: 50 }, p),
    'min_caliber_score',
  );
  expectOk(
    'score at minimum passes',
    evaluatePolicy({ host: 'a.com', payToUsdc: '0.001' }, { ...baseCtx, caliberScore: 75 }, p),
  );
}

console.log('\n# approval threshold → hold');
{
  const p: CompiledPolicy = { ...basePolicy, approvalThresholdUsdc: '0.002' };
  expectOk(
    'at/below threshold passes',
    evaluatePolicy({ host: 'a.com', payToUsdc: '0.002' }, baseCtx, p),
  );
  expectHold(
    'above threshold holds',
    evaluatePolicy({ host: 'a.com', payToUsdc: '0.003' }, baseCtx, p),
    'approval_threshold',
  );
}

console.log('\n# newCounterparty modes');
{
  const hold: CompiledPolicy = { ...basePolicy, newCounterparty: 'hold' };
  expectHold(
    'new counterparty holds under hold policy',
    evaluatePolicy({ host: 'a.com', payToUsdc: '0.001' }, { ...baseCtx, isNewCounterparty: true }, hold),
    'new_counterparty',
  );
  expectOk(
    'known counterparty unaffected by hold policy',
    evaluatePolicy({ host: 'a.com', payToUsdc: '0.001' }, { ...baseCtx, isNewCounterparty: false }, hold),
  );

  const sandbox: CompiledPolicy = {
    ...basePolicy,
    newCounterparty: 'sandbox',
    sandboxCapUsdc: '0.001',
  };
  expectOk(
    'new counterparty under sandbox cap passes',
    evaluatePolicy({ host: 'a.com', payToUsdc: '0.001' }, { ...baseCtx, isNewCounterparty: true }, sandbox),
  );
  expectDeny(
    'new counterparty over sandbox cap denies',
    evaluatePolicy({ host: 'a.com', payToUsdc: '0.002' }, { ...baseCtx, isNewCounterparty: true }, sandbox),
    'sandbox_cap',
  );
}

console.log('\n# runaway-loop detector');
{
  check(
    'below threshold does not fire',
    checkRunawayLoop({ recentCount: 2, threshold: 3, windowMinutes: 10 }).hit === false,
  );
  check(
    'at threshold fires',
    checkRunawayLoop({ recentCount: 3, threshold: 3, windowMinutes: 10 }).hit === true,
  );
  check(
    'above threshold fires with count evidence',
    checkRunawayLoop({ recentCount: 7, threshold: 5, windowMinutes: 10 }).count === 7,
  );
}

console.log('\n# price-spike detector');
{
  check(
    'cold start (too few samples) abstains',
    checkPriceSpike({ quoteUsdc: '0.01', medianUsdc: '0.001', sampleCount: 4, minSamples: 5, multiplier: 3 }).hit === false,
  );
  check(
    'null median abstains',
    checkPriceSpike({ quoteUsdc: '0.01', medianUsdc: null, sampleCount: 9, minSamples: 5, multiplier: 3 }).hit === false,
  );
  const spike = checkPriceSpike({ quoteUsdc: '0.01', medianUsdc: '0.001', sampleCount: 9, minSamples: 5, multiplier: 3 });
  check('10x quote over 3x threshold fires', spike.hit === true);
  check('spike evidence carries quote + median', spike.quote === '0.01' && spike.median === '0.001');
  check(
    'quote within multiplier does not fire',
    checkPriceSpike({ quoteUsdc: '0.0025', medianUsdc: '0.001', sampleCount: 9, minSamples: 5, multiplier: 3 }).hit === false,
  );
  check(
    'quote exactly at multiplier does not fire (strict >)',
    checkPriceSpike({ quoteUsdc: '0.003', medianUsdc: '0.001', sampleCount: 9, minSamples: 5, multiplier: 3 }).hit === false,
  );
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error('FAILURES:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
console.log('all policy assertions pass.\n');
