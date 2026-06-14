// Acceptance harness for Steward Phase 1 tasks 8 + 10. Drives the live service
// through the steward-client, flipping the redteam fixture between modes.
//
//   honest    → allow + settle
//   redirect  → deny @ detector + incident, no settlement
//   overcharge→ deny @ policy (cap), no settlement
//
// Run:  tsx --env-file=../../.env scripts/accept.ts

import { createSteward, StewardRefusal } from '@caliber/steward-client';

const STEWARD = 'http://localhost:3300';
const REDTEAM = 'http://localhost:3400';
const RESOURCE = `${REDTEAM}/api/research`;

const apiKey = process.env.STEWARD_API_KEY!;
const adminToken = process.env.REDTEAM_ADMIN_TOKEN!;
const steward = createSteward({ baseUrl: STEWARD, apiKey });

async function setMode(mode: string): Promise<void> {
  const res = await fetch(`${REDTEAM}/admin/mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-redteam-admin': adminToken },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) throw new Error(`setMode(${mode}) failed: ${res.status} ${await res.text()}`);
  console.log(`\n--- fixture mode → ${mode} ---`);
}

async function tryPay(label: string): Promise<void> {
  try {
    const res = await steward.pay(RESOURCE, { method: 'POST' });
    console.log(`[${label}] ALLOW  stage=${res.stage}  reasoning="${res.reasoning}"`);
    console.log(`         quote=${JSON.stringify(res.quote)}  txRef=${res.txRef ?? '(none)'}  requestId=${res.requestId}`);
  } catch (err) {
    if (err instanceof StewardRefusal) {
      console.log(`[${label}] ${err.decision.toUpperCase()}   stage=${err.stage}  http=${err.httpStatus}  reasoning="${err.reasoning}"  requestId=${err.requestId}`);
    } else {
      console.log(`[${label}] ERROR  ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function main() {
  await setMode('honest');
  await tryPay('honest');

  await setMode('redirect');
  await tryPay('redirect');

  await setMode('overcharge');
  await tryPay('overcharge');

  // leave fixture honest for any follow-up freeze test
  await setMode('honest');
  console.log('\ndone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
