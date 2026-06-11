// Staged slash demo (Lepton Phase 2, B4). Re-runnable for judges + the video.
//
// Drives the full bond → slash lifecycle on-chain using wallets we control for
// every role (a fresh provider can't be Caliber-rated, so this demonstrates the
// *mechanism*; the broker's rating-based decline is shown separately in the
// console against real rated agents):
//
//   1. client  (TEST_FUNDER) createJob with provider = HireBot EOA, funds a tiny budget
//   2. provider (HireBot)     setBudget
//   3. client                 approve USDC + fund
//   4. broker                 postBond on BrokerBond for the job (records broker_matches)
//   5. provider               submit deliverable
//   6. client/evaluator       reject  → job terminal (Rejected)
//   7. keeper                 slash    → bond goes to the requester (client)
//
// Prerequisites: BROKERBOND_ADDRESS set (deploy first), and the client/provider
// wallets funded with a little USDC + gas on Arc Testnet.
//
//   pnpm --filter @caliber/broker exec tsx --env-file=../../.env scripts/demo-slash.ts

import { createWalletClient, createPublicClient, http, defineChain, stringToHex, padHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { db, brokerMatches, sql } from '@arc-agents/db';
import { config } from '../src/config.js';
import { postBondOnChain, slashOnChain, getJobStatus, toMicro } from '../src/chain.js';

const AGENTIC_ABI = [
  { type: 'function', name: 'createJob', stateMutability: 'nonpayable', inputs: [{ name: 'provider', type: 'address' }, { name: 'evaluator', type: 'address' }, { name: 'expiredAt', type: 'uint256' }, { name: 'description', type: 'string' }, { name: 'hook', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'setBudget', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'amount', type: 'uint256' }, { name: 'optParams', type: 'bytes' }], outputs: [] },
  { type: 'function', name: 'fund', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'optParams', type: 'bytes' }], outputs: [] },
  { type: 'function', name: 'submit', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'deliverable', type: 'bytes32' }, { name: 'optParams', type: 'bytes' }], outputs: [] },
  { type: 'function', name: 'reject', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'reason', type: 'bytes32' }, { name: 'optParams', type: 'bytes' }], outputs: [] },
  { type: 'event', name: 'JobCreated', inputs: [{ name: 'jobId', type: 'uint256', indexed: true }, { name: 'client', type: 'address', indexed: true }, { name: 'provider', type: 'address', indexed: true }, { name: 'evaluator', type: 'address' }, { name: 'expiredAt', type: 'uint256' }, { name: 'hook', type: 'address' }] },
] as const;
const ERC20_ABI = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;

const arc = defineChain({ id: config.chainId, name: 'Arc Testnet', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl ?? ''] } } });
const pub = createPublicClient({ chain: arc, transport: http(config.rpcUrl) });
const wallet = (key: Hex) => createWalletClient({ account: privateKeyToAccount(key), chain: arc, transport: http(config.rpcUrl) });
const key = (envKey: string | undefined, label: string): Hex => {
  if (!envKey) throw new Error(`${label} not set`);
  return (envKey.startsWith('0x') ? envKey : `0x${envKey}`) as Hex;
};
const b32 = (s: string): Hex => padHex(stringToHex(s.slice(0, 31)), { size: 32 });

const BUDGET_USDC = Number(process.env.DEMO_JOB_USDC ?? 0.1);
const BOND_USDC = Number(process.env.DEMO_BOND_USDC ?? 0.05);

async function send(w: ReturnType<typeof wallet>, params: Parameters<typeof w.writeContract>[0]): Promise<Hex> {
  const hash = await w.writeContract(params);
  await pub.waitForTransactionReceipt({ hash });
  return hash;
}

async function main() {
  if (!config.brokerBondAddress) throw new Error('BROKERBOND_ADDRESS not set — deploy BrokerBond first');
  const clientKey = key(process.env.TEST_FUNDER_PRIVATE_KEY, 'TEST_FUNDER_PRIVATE_KEY');
  const providerKey = key(process.env.HIREBOT_PRIVATE_KEY, 'HIREBOT_PRIVATE_KEY');
  const client = wallet(clientKey);
  const provider = wallet(providerKey);
  const clientAddr = client.account.address as Address;
  const providerAddr = provider.account.address as Address;

  console.log(`[demo] client=${clientAddr} provider=${providerAddr}`);

  // 1. createJob
  const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const createHash = await send(client, { address: config.agenticCommerce, abi: AGENTIC_ABI, functionName: 'createJob', args: [providerAddr, clientAddr, expiredAt, 'lepton bond-slash demo', '0x0000000000000000000000000000000000000000'], chain: arc, account: client.account });
  const rcpt = await pub.getTransactionReceipt({ hash: createHash });
  // jobId is the first indexed topic of JobCreated (topic[1]).
  const jobId = BigInt(rcpt.logs.find((l) => l.address.toLowerCase() === config.agenticCommerce.toLowerCase())?.topics[1] ?? '0x0');
  console.log(`[demo] 1. created job ${jobId} (${createHash})`);

  // 2. setBudget (provider)
  await send(provider, { address: config.agenticCommerce, abi: AGENTIC_ABI, functionName: 'setBudget', args: [jobId, toMicro(BUDGET_USDC), '0x'], chain: arc, account: provider.account });
  console.log(`[demo] 2. budget set $${BUDGET_USDC}`);

  // 3. approve + fund (client)
  await send(client, { address: config.usdc, abi: ERC20_ABI, functionName: 'approve', args: [config.agenticCommerce, toMicro(BUDGET_USDC)], chain: arc, account: client.account });
  await send(client, { address: config.agenticCommerce, abi: AGENTIC_ABI, functionName: 'fund', args: [jobId, '0x'], chain: arc, account: client.account });
  console.log(`[demo] 3. funded`);

  // 4. broker posts the bond
  const { bondId, txHash } = await postBondOnChain(jobId, clientAddr, BOND_USDC);
  await db.insert(brokerMatches).values({
    requesterAddr: clientAddr, jobId, providerId: null, status: 'bonded',
    feeUsdc: '0', bondUsdc: BOND_USDC.toFixed(6), bondId, attestationsBought: 0,
    decisionLog: [{ step: 'demo', detail: `staged slash demo: bond $${BOND_USDC} posted for job ${jobId}`, ref: txHash }],
  });
  console.log(`[demo] 4. bond ${bondId} posted ($${BOND_USDC}) ${txHash}`);

  // 5. submit (provider) 6. reject (client/evaluator)
  await send(provider, { address: config.agenticCommerce, abi: AGENTIC_ABI, functionName: 'submit', args: [jobId, b32('deliverable'), '0x'], chain: arc, account: provider.account });
  console.log(`[demo] 5. deliverable submitted`);
  await send(client, { address: config.agenticCommerce, abi: AGENTIC_ABI, functionName: 'reject', args: [jobId, b32('demo rejection'), '0x'], chain: arc, account: client.account });
  console.log(`[demo] 6. job rejected · status now ${await getJobStatus(jobId)}`);

  // 7. slash (keeper duty; permissionless)
  const slashTx = await slashOnChain(bondId);
  await sql`UPDATE broker_matches SET status='slashed', decision_log = decision_log || ${JSON.stringify([{ step: 'slash', detail: `job rejected → bond ${bondId} slashed to requester`, ref: slashTx }])}::jsonb WHERE bond_id = ${String(bondId)}`;
  console.log(`[demo] 7. SLASHED → bond ${bondId} paid to requester ${clientAddr} (${slashTx})`);
  console.log(`[demo] done. Bond board: caliber.poko.blue/labs/broker`);
  await sql.end();
}

main().catch((e) => { console.error('[demo] failed:', e instanceof Error ? e.message : e); process.exit(1); });
