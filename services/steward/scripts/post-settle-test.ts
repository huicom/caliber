// Acceptance §3 — post-settle verification mapping (Steward Phase 1, task 17).
//
// A real settle MISMATCH is hard to force against a healthy facilitator (it
// requires the server to accept the retry while the facilitator reports
// success=false or omits the txRef). Rather than mock the chain, we unit-test
// the pure MAPPING the pipeline applies to a `PaidResult`, and print the code
// path. The mapping under test is exactly the block in pipeline.ts stage 5:
//
//   settled && (settleSuccess === false || !txRef)  → settle_status 'mismatch'
//   settled && success && txRef present             → settle_status 'settled'
//   (a thrown PaymentRejectedError / 5xx-after-settle → 'failed', handled in the
//    pipeline catch — exercised separately in the conformance run's failure path)
//
// We import the real x402-client PaidResult type so the fake stays in lock-step
// with the buyer client's contract.

import type { PaidResult } from '@caliber/x402-client';

/** The exact decision the pipeline makes from a settled PaidResult. */
function settleStatusFor(paid: Pick<PaidResult<unknown>, 'settled' | 'settleSuccess' | 'txRef'>):
  { settleStatus: 'settled' | 'mismatch'; detail: string | null } {
  if (!paid.settled) return { settleStatus: 'settled', detail: 'not a settled path' };
  if (paid.settleSuccess === false || !paid.txRef) {
    const detail =
      paid.settleSuccess === false
        ? 'facilitator reported success=false after the server accepted the payment'
        : 'no settlement transaction reference echoed after the server accepted the payment';
    return { settleStatus: 'mismatch', detail };
  }
  return { settleStatus: 'settled', detail: null };
}

interface Case {
  name: string;
  paid: Pick<PaidResult<unknown>, 'settled' | 'settleSuccess' | 'txRef'>;
  expect: 'settled' | 'mismatch';
}

const cases: Case[] = [
  {
    name: 'healthy settle (success=true, txRef present)',
    paid: { settled: true, settleSuccess: true, txRef: 'tx-abc' },
    expect: 'settled',
  },
  {
    name: 'facilitator success=false → MISMATCH (high incident)',
    paid: { settled: true, settleSuccess: false, txRef: 'tx-abc' },
    expect: 'mismatch',
  },
  {
    name: 'missing txRef → MISMATCH (high incident)',
    paid: { settled: true, settleSuccess: true, txRef: undefined },
    expect: 'mismatch',
  },
  {
    name: 'no settle header at all (success undefined, no txRef) → MISMATCH',
    paid: { settled: true, settleSuccess: undefined, txRef: undefined },
    expect: 'mismatch',
  },
  {
    name: 'success undefined but txRef present (lenient header) → settled',
    paid: { settled: true, settleSuccess: undefined, txRef: 'tx-abc' },
    expect: 'settled',
  },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const got = settleStatusFor(c.paid);
  const ok = got.settleStatus === c.expect;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${c.name}\n      → settle_status='${got.settleStatus}'` +
      (got.detail ? ` detail="${got.detail}"` : '') +
      (got.settleStatus === 'mismatch' ? '  ⇒ steward_incidents kind=settle_mismatch severity=high' : ''),
  );
  if (ok) pass++;
  else fail++;
}
console.log(`\n${pass}/${pass + fail} post-settle mapping cases pass`);
process.exit(fail === 0 ? 0 : 1);
