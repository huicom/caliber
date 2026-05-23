// Backend helpers for Circle User-Controlled Wallets (PIN auth).
//
// Architecture:
//   1. Browser session id ↔ Circle user id (stable per session cookie)
//   2. Backend creates the user, mints a userToken (JWT), returns to frontend
//   3. Frontend SDK (@circle-fin/w3s-pw-web-sdk) uses userToken + encryptionKey
//      to prompt the user for PIN setup / signing challenges
//   4. For each on-chain action, backend creates a "challenge" (PIN-required
//      operation) and returns challengeId; frontend SDK runs it interactively
//
// Required env vars:
//   CIRCLE_API_KEY              (already set — shared with dev-controlled)
//   NEXT_PUBLIC_CIRCLE_APP_ID   (W3S App ID from Circle Console — frontend uses it)

import { createHash } from 'node:crypto';
import { initiateUserControlledWalletsClient } from '@circle-fin/user-controlled-wallets';
import { DEMO_BLOCKCHAIN } from './client';

let _client: ReturnType<typeof initiateUserControlledWalletsClient> | null = null;

export function getUserControlledClient() {
  if (_client) return _client;
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) throw new Error('CIRCLE_API_KEY must be set');
  _client = initiateUserControlledWalletsClient({ apiKey });
  return _client;
}

/**
 * Returns true if the User-Controlled Wallets path is fully configured.
 * Used by the route + UI to show "not configured" message when missing.
 */
export function isUserControlledConfigured(): boolean {
  return !!process.env.CIRCLE_API_KEY && !!process.env.NEXT_PUBLIC_CIRCLE_APP_ID;
}

/**
 * Stable Circle user id derived from the browser session cookie. Circle
 * requires UUID format (8-4-4-4-12 hex); we derive a deterministic UUID v4-
 * shaped string from sha256(sessionId) so the same browser always maps to
 * the same Circle user across page reloads.
 */
export function userIdForSession(sessionId: string): string {
  const h = createHash('sha256').update(`caliber-demo:${sessionId}`).digest('hex');
  // Force version (4) and variant (8) nibbles to keep the string a valid UUID.
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    '4' + h.slice(13, 16),
    '8' + h.slice(17, 20),
    h.slice(20, 32),
  ].join('-');
}

/**
 * Returns a userToken for the session's Circle user, creating the user
 * on first call. createUser is best-effort: Circle's SDK throws *without*
 * a status code (just a message "Existing user already created…") when
 * the user exists, so we can't reliably switch on the error. Instead we
 * always attempt createUser, swallow any failure, and let createUserToken
 * be the source of truth — it works for both fresh and existing users.
 * userToken expires after 60 minutes per Circle docs.
 */
export async function createOrGetUserSession(sessionId: string): Promise<{
  userId: string;
  userToken: string;
  encryptionKey: string;
}> {
  const c = getUserControlledClient();
  const userId = userIdForSession(sessionId);

  try {
    await c.createUser({ userId });
  } catch {
    // existing-user errors are expected on every call after the first;
    // createUserToken handles both cases correctly.
  }

  const tokenRes = await c.createUserToken({ userId });
  const userToken = tokenRes.data?.userToken;
  const encryptionKey = tokenRes.data?.encryptionKey;
  if (!userToken || !encryptionKey) {
    throw new Error('Circle createUserToken returned no token/encryptionKey');
  }
  return { userId, userToken, encryptionKey };
}

/**
 * Challenge that the frontend runs via sdk.execute(challengeId). Either
 * creates a wallet + PIN (first time) or just creates a wallet (PIN
 * already set). The frontend SDK shows the appropriate UI.
 */
export async function createWalletWithPinChallenge(
  userToken: string,
): Promise<{ challengeId: string }> {
  const c = getUserControlledClient();
  const res = await c.createUserPinWithWallets({
    userToken,
    blockchains: [DEMO_BLOCKCHAIN as 'ARC-TESTNET'],
    accountType: 'EOA',
  });
  const challengeId = res.data?.challengeId;
  if (!challengeId) throw new Error('createUserPinWithWallets returned no challengeId');
  return { challengeId };
}

/**
 * Contract execution challenge — frontend SDK prompts user for PIN
 * to sign + submit. Use for USDC.approve, postGatedJob, etc.
 */
export async function createContractExecutionChallenge(opts: {
  userToken: string;
  walletId: string;
  contractAddress: `0x${string}`;
  /** Pre-encoded transaction calldata (use viem encodeFunctionData). */
  callData: `0x${string}`;
  refId?: string;
}): Promise<{ challengeId: string }> {
  const c = getUserControlledClient();
  const res = await c.createUserTransactionContractExecutionChallenge({
    userToken: opts.userToken,
    walletId: opts.walletId,
    contractAddress: opts.contractAddress,
    callData: opts.callData,
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    refId: opts.refId,
  });
  const challengeId = res.data?.challengeId;
  if (!challengeId) throw new Error('contract execution challenge returned no challengeId');
  return { challengeId };
}

/**
 * Read the user's wallets — typically one per blockchain after the first
 * challenge completes. Returns null if no wallet exists yet.
 */
export async function getUserWallet(userToken: string): Promise<{
  id: string;
  address: `0x${string}`;
  blockchain: string;
} | null> {
  const c = getUserControlledClient();
  const res = await c.listWallets({ userToken, blockchain: DEMO_BLOCKCHAIN as 'ARC-TESTNET' });
  const wallet = res.data?.wallets?.[0];
  if (!wallet) return null;
  return {
    id: wallet.id,
    address: wallet.address as `0x${string}`,
    blockchain: wallet.blockchain,
  };
}

/** Poll a transaction by id until it reaches a terminal state. */
export async function getUserTransactionStatus(
  userToken: string,
  transactionId: string,
): Promise<{ state: string; txHash: string | null; errorReason: string | null }> {
  const c = getUserControlledClient();
  const res = await c.getTransaction({ userToken, id: transactionId });
  const tx = res.data?.transaction;
  if (!tx) throw new Error(`transaction ${transactionId} not found`);
  return {
    state: tx.state ?? 'UNKNOWN',
    txHash: tx.txHash ?? null,
    errorReason: tx.errorReason ?? null,
  };
}
