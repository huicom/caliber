// High-level helpers built on top of the Circle SDK: get-or-create a
// demo wallet for a session, request testnet USDC, execute a Caliber-
// gated contract call. Encodes contract calls server-side via viem
// and passes the raw `callData` to Circle's contractExecution endpoint —
// avoids the ABI-parameter-encoding pitfalls of nested tuple structs
// like RatingAttestation.

import { encodeFunctionData, type Abi } from 'viem';
import { getCircleClient, getDemoWalletSetId, DEMO_BLOCKCHAIN } from './client';
import { refIdForSession } from './session';

export interface CircleWallet {
  id: string;
  address: `0x${string}`;
  blockchain: string;
  state: string;
  isNew: boolean;
}

/**
 * Returns the Circle wallet for the given session, creating one if it
 * doesn't exist yet. Idempotent on the refId.
 */
export async function getOrCreateWallet(sessionId: string): Promise<CircleWallet> {
  const client = getCircleClient();
  const refId = refIdForSession(sessionId);

  // Existing wallet?
  const list = await client.listWallets({ refId, blockchain: DEMO_BLOCKCHAIN });
  const existing = list.data?.wallets?.[0];
  if (existing) {
    return {
      id: existing.id,
      address: existing.address as `0x${string}`,
      blockchain: existing.blockchain,
      state: existing.state,
      isNew: false,
    };
  }

  // Create fresh.
  const created = await client.createWallets({
    walletSetId: getDemoWalletSetId(),
    blockchains: [DEMO_BLOCKCHAIN],
    count: 1,
    metadata: [{ refId, name: `caliber-demo:${sessionId.slice(0, 8)}` }],
  });
  const wallet = created.data?.wallets?.[0];
  if (!wallet) throw new Error('Circle createWallets returned no wallet');
  return {
    id: wallet.id,
    address: wallet.address as `0x${string}`,
    blockchain: wallet.blockchain,
    state: wallet.state,
    isNew: true,
  };
}

export async function requestFaucet(address: string): Promise<void> {
  const client = getCircleClient();
  await client.requestTestnetTokens({
    address,
    blockchain: DEMO_BLOCKCHAIN as 'ARC-TESTNET',
    usdc: true,
    native: true,
  });
}

/**
 * Reads the wallet's token balance and returns the total native + USDC
 * amount (decimal sum, not strictly accurate for cross-asset math but
 * fine for "is it > 0 ?" checks).
 */
export async function getWalletBalance(walletId: string): Promise<number> {
  const client = getCircleClient();
  const r = await client.getWalletTokenBalance({ id: walletId });
  const balances = r.data?.tokenBalances ?? [];
  let total = 0;
  for (const b of balances) {
    const n = parseFloat(b.amount ?? '0');
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

/**
 * Reads wallet balance. Returns true if any tokens are present.
 * Circle's programmatic faucet returns 403 on Arc Testnet; manual funding
 * via https://faucet.circle.com is the only path. This is a stub for the
 * "available backend integration" story — not on the live UI critical path.
 */
export async function ensureFunded(
  walletId: string,
  _address: string,
): Promise<{ funded: boolean; balance: number }> {
  const balance = await getWalletBalance(walletId);
  return { funded: balance > 0, balance };
}

/**
 * Executes a contract call from the session's wallet. Returns the
 * Circle transaction id — poll `getTransactionStatus(id)` until state
 * is COMPLETE or CONFIRMED.
 */
export async function executeContractCall(opts: {
  walletId: string;
  contractAddress: `0x${string}`;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  /** Optional ETH value to send with the call (decimal string). */
  amount?: string;
  /** Reference label that lands in Circle's transaction history. */
  refId?: string;
}): Promise<string> {
  const client = getCircleClient();
  const callData = encodeFunctionData({
    abi: opts.abi,
    functionName: opts.functionName,
    args: opts.args,
  });
  const response = await client.createContractExecutionTransaction({
    walletId: opts.walletId,
    contractAddress: opts.contractAddress,
    callData,
    amount: opts.amount,
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    refId: opts.refId,
  });
  const id = response.data?.id;
  if (!id) throw new Error('Circle returned no transaction id');
  return id;
}

export type TransactionState =
  | 'INITIATED'
  | 'QUEUED'
  | 'SENT'
  | 'CONFIRMED'
  | 'COMPLETE'
  | 'FAILED'
  | 'CANCELLED'
  | 'DENIED'
  | 'CLEARED'
  | 'STUCK';

export interface TransactionStatus {
  id: string;
  state: TransactionState;
  txHash: string | null;
  errorReason: string | null;
}

export async function getTransactionStatus(id: string): Promise<TransactionStatus> {
  const client = getCircleClient();
  const response = await client.getTransaction({ id });
  const tx = response.data?.transaction;
  if (!tx) throw new Error(`Circle transaction ${id} not found`);
  return {
    id: tx.id,
    state: tx.state as TransactionState,
    txHash: tx.txHash ?? null,
    errorReason: tx.errorReason ?? null,
  };
}
