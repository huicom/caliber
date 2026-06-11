// Caliber x402 buyer CLI — ops + the P0.4 rail smoke test.
//
//   pnpm --filter @caliber/x402-client balances
//   pnpm --filter @caliber/x402-client deposit -- --amount 5
//   pnpm --filter @caliber/x402-client smoke   -- --agent 123
//
// Reads the buyer key + API base from the repo-root .env (loaded via
// tsx --env-file). Key precedence: CALIBER_PAYER_PRIVATE_KEY → HIREBOT_PRIVATE_KEY
// → TEST_FUNDER_PRIVATE_KEY (last as a fallback so the rail can be smoke-tested
// before the dedicated HireBot wallet exists). API base: CALIBER_API_BASE, else
// the public production host.

import { CaliberPayer, DEFAULT_API_BASE } from './index.js';
import type { Hex } from 'viem';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1];
  return undefined;
}

function resolveKey(): Hex {
  const key =
    process.env.CALIBER_PAYER_PRIVATE_KEY ||
    process.env.HIREBOT_PRIVATE_KEY ||
    process.env.TEST_FUNDER_PRIVATE_KEY;
  if (!key) {
    throw new Error(
      'No buyer key. Set CALIBER_PAYER_PRIVATE_KEY (or HIREBOT_PRIVATE_KEY / TEST_FUNDER_PRIVATE_KEY) in .env',
    );
  }
  return (key.startsWith('0x') ? key : `0x${key}`) as Hex;
}

function makePayer(): CaliberPayer {
  return new CaliberPayer({
    privateKey: resolveKey(),
    apiBase: process.env.CALIBER_API_BASE || DEFAULT_API_BASE,
  });
}

async function cmdBalances(): Promise<void> {
  const payer = makePayer();
  console.log(`[balances] wallet ${payer.address}`);
  const b = await payer.getBalances();
  console.log(`  wallet USDC:           ${b.wallet.formatted}`);
  console.log(`  gateway total:         ${b.gateway.formattedTotal}`);
  console.log(`  gateway available:     ${b.gateway.formattedAvailable}`);
  console.log(`  gateway withdrawable:  ${b.gateway.formattedWithdrawable}`);
}

async function cmdDeposit(): Promise<void> {
  const amount = arg('amount');
  if (!amount) throw new Error('deposit requires --amount <usdc>, e.g. --amount 5');
  const payer = makePayer();
  console.log(`[deposit] depositing ${amount} USDC into Gateway from ${payer.address}…`);
  const r = await payer.deposit(amount);
  if (r.approvalTxHash) console.log(`  approve tx: ${r.approvalTxHash}`);
  console.log(`  deposit tx: ${r.depositTxHash}`);
  console.log(`  deposited:  ${r.formattedAmount} USDC`);
}

async function cmdSmoke(): Promise<void> {
  const agent = arg('agent') || process.env.CALIBER_SMOKE_AGENT_ID;
  if (!agent) throw new Error('smoke requires --agent <id> (or CALIBER_SMOKE_AGENT_ID)');
  const payer = makePayer();
  console.log(`[smoke] buyer ${payer.address} → ${payer.apiBase}`);
  console.log(`[smoke] paying for attestation of agent ${agent}…`);
  const res = await payer.payForAttestation(agent);
  console.log(`  HTTP ${res.status}`);
  console.log(`  paid ${res.payment.amountUsdc} USDC · settle ref ${res.payment.transaction}`);
  if (res.status >= 200 && res.status < 300) {
    console.log(`  tier=${res.data.tier} score=${res.data.score} confidence=${res.data.confidence}`);
    console.log(`  methodology=${res.data.methodologyVersion}`);
    console.log(`  signature=${String(res.data.signature).slice(0, 22)}…`);
    console.log('[smoke] ✓ end-to-end paid attestation succeeded');
  } else {
    console.log(`  not rated: ${res.data.reason} — ${res.data.detail}`);
    console.log('[smoke] payment settled but agent unrated; pick a rated agent id.');
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'balances':
      return cmdBalances();
    case 'deposit':
      return cmdDeposit();
    case 'smoke':
      return cmdSmoke();
    default:
      console.error('usage: cli.ts <balances|deposit|smoke> [--amount N] [--agent ID]');
      process.exit(1);
  }
}

main().catch((e) => {
  console.error('[error]', e instanceof Error ? e.message : e);
  process.exit(1);
});
