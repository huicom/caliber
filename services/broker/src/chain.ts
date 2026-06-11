// On-chain helpers for BrokerBond + ERC-8183, via viem. All bond-moving calls
// are gated on BROKERBOND_ADDRESS being set (filled after deploy). The keeper
// and the staged-slash demo use these; the match flow uses postBond().

import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { config, requireBrokerKey } from './config.js';

const arcTestnet = defineChain({
  id: config.chainId,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl ?? ''] } },
});

const BROKERBOND_ABI = [
  { type: 'function', name: 'postBond', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'requester', type: 'address' }, { name: 'provider', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: 'bondId', type: 'uint256' }] },
  { type: 'function', name: 'release', stateMutability: 'nonpayable', inputs: [{ name: 'bondId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'slash', stateMutability: 'nonpayable', inputs: [{ name: 'bondId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'bondCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'event', name: 'BondPosted', inputs: [{ name: 'bondId', type: 'uint256', indexed: true }, { name: 'jobId', type: 'uint256', indexed: true }, { name: 'broker', type: 'address', indexed: true }, { name: 'requester', type: 'address', indexed: false }, { name: 'provider', type: 'address', indexed: false }, { name: 'amount', type: 'uint256', indexed: false }] },
] as const;

// getJob returns a single struct (tuple), not 9 flat values — must match the
// real contract's ABI encoding or viem misdecodes.
const ERC8183_ABI = [
  {
    type: 'function', name: 'getJob', stateMutability: 'view',
    inputs: [{ name: 'jobId', type: 'uint256' }],
    outputs: [{
      name: '', type: 'tuple', components: [
        { name: 'id', type: 'uint256' }, { name: 'client', type: 'address' }, { name: 'provider', type: 'address' },
        { name: 'evaluator', type: 'address' }, { name: 'description', type: 'string' }, { name: 'budget', type: 'uint256' },
        { name: 'expiredAt', type: 'uint256' }, { name: 'status', type: 'uint8' }, { name: 'hook', type: 'address' },
      ],
    }],
  },
] as const;

const ERC20_ABI = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

export const JOB_STATUS = ['Open', 'Funded', 'Submitted', 'Completed', 'Rejected', 'Expired'] as const;
export type JobStatusName = (typeof JOB_STATUS)[number];

export function publicClient() {
  return createPublicClient({ chain: arcTestnet, transport: http(config.rpcUrl) });
}

export function brokerWallet() {
  const account = privateKeyToAccount(requireBrokerKey());
  return createWalletClient({ account, chain: arcTestnet, transport: http(config.rpcUrl) });
}

export function brokerAddress(): Address {
  return privateKeyToAccount(requireBrokerKey()).address;
}

function bondAddr(): Address {
  if (!config.brokerBondAddress) throw new Error('BROKERBOND_ADDRESS not set (deploy BrokerBond first)');
  return config.brokerBondAddress;
}

/** USDC has 6 decimals on Arc. */
export const toMicro = (usdc: number): bigint => BigInt(Math.round(usdc * 1_000_000));

async function readJob(jobId: bigint) {
  return publicClient().readContract({ address: config.agenticCommerce, abi: ERC8183_ABI, functionName: 'getJob', args: [jobId] });
}

export async function getJobStatus(jobId: bigint): Promise<JobStatusName> {
  const job = await readJob(jobId);
  return JOB_STATUS[Number(job.status)] ?? 'Open';
}

/** On-chain provider address for a job (BrokerBond.postBond requires it to match). */
export async function getJobProvider(jobId: bigint): Promise<Address> {
  const job = await readJob(jobId);
  return job.provider;
}

export async function ensureApproval(amountMicro: bigint): Promise<void> {
  const pub = publicClient();
  const owner = brokerAddress();
  const allowance = await pub.readContract({ address: config.usdc, abi: ERC20_ABI, functionName: 'allowance', args: [owner, bondAddr()] });
  if (allowance >= amountMicro) return;
  const wallet = brokerWallet();
  const hash = await wallet.writeContract({ address: config.usdc, abi: ERC20_ABI, functionName: 'approve', args: [bondAddr(), toMicro(1_000_000)], chain: wallet.chain, account: wallet.account! });
  await pub.waitForTransactionReceipt({ hash });
}

/** Post a bond on-chain; reads the job's provider so it matches the contract
 *  guard. Returns { bondId, txHash }. */
export async function postBondOnChain(jobId: bigint, requester: Address, amountUsdc: number): Promise<{ bondId: bigint; txHash: Hex }> {
  const amount = toMicro(amountUsdc);
  const provider = await getJobProvider(jobId);
  await ensureApproval(amount);
  const pub = publicClient();
  const wallet = brokerWallet();
  const hash = await wallet.writeContract({ address: bondAddr(), abi: BROKERBOND_ABI, functionName: 'postBond', args: [jobId, requester, provider, amount], chain: wallet.chain, account: wallet.account! });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  // Read bondCount as the assigned id (postBond increments then assigns).
  const bondId = await pub.readContract({ address: bondAddr(), abi: BROKERBOND_ABI, functionName: 'bondCount' });
  void receipt;
  return { bondId, txHash: hash };
}

export async function releaseOnChain(bondId: bigint): Promise<Hex> {
  const pub = publicClient();
  const wallet = brokerWallet();
  const hash = await wallet.writeContract({ address: bondAddr(), abi: BROKERBOND_ABI, functionName: 'release', args: [bondId], chain: wallet.chain, account: wallet.account! });
  await pub.waitForTransactionReceipt({ hash });
  return hash;
}

export async function slashOnChain(bondId: bigint): Promise<Hex> {
  const pub = publicClient();
  const wallet = brokerWallet();
  const hash = await wallet.writeContract({ address: bondAddr(), abi: BROKERBOND_ABI, functionName: 'slash', args: [bondId], chain: wallet.chain, account: wallet.account! });
  await pub.waitForTransactionReceipt({ hash });
  return hash;
}
