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

/**
 * Create a Circle signTypedData challenge for an EIP-712 payload. Used for
 * the x402 EIP-3009 TransferWithAuthorization signing on the Circle
 * Programmable Wallet path. Returns the challengeId — the browser runs
 * `sdk.execute(challengeId, callback)` to prompt the user's PIN modal.
 */
export async function createSignTypedDataChallenge(opts: {
  userToken: string;
  walletId: string;
  typedData: string; // JSON-stringified EIP-712 message
  memo?: string;
}): Promise<{ challengeId: string }> {
  const c = getUserControlledClient();
  const res = await c.signTypedData({
    userToken: opts.userToken,
    walletId: opts.walletId,
    data: opts.typedData,
    memo: opts.memo ?? 'Caliber x402 attestation fee',
  });
  // The SDK returns the challenge under data.challengeId, even though
  // the wrapping type is named "Signature".
  const challengeId = (res.data as unknown as { challengeId?: string })?.challengeId;
  if (!challengeId) throw new Error('signTypedData returned no challengeId');
  return { challengeId };
}

/**
 * Fetch the signature result for a completed Circle challenge. Polls until
 * the challenge reaches COMPLETE state (or FAILED / EXPIRED). The signature
 * itself is delivered to the browser via the SDK execute() callback, but
 * we also fetch server-side here as a defensive double-check / fallback
 * in case the browser callback doesn't surface it.
 */
export async function pollChallengeSignature(
  userToken: string,
  challengeId: string,
  maxWaitMs = 15_000,
): Promise<{ status: string; signature: string | null; errorMessage: string | null }> {
  const c = getUserControlledClient();
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    const res = await c.getUserChallenge({ userToken, challengeId }).catch(() => null);
    const ch = res?.data?.challenge as
      | {
          status?: string;
          errorMessage?: string;
          // The signature may surface as different field names depending on
          // the SDK version; we'll try a few.
          signature?: string;
          result?: { signature?: string };
        }
      | undefined;
    const status = ch?.status ?? 'UNKNOWN';
    if (status === 'COMPLETE') {
      const sig = ch?.signature ?? ch?.result?.signature ?? null;
      return { status, signature: sig, errorMessage: null };
    }
    if (status === 'FAILED' || status === 'EXPIRED') {
      return {
        status,
        signature: null,
        errorMessage: ch?.errorMessage ?? `challenge ${status.toLowerCase()}`,
      };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { status: 'TIMEOUT', signature: null, errorMessage: 'challenge poll timeout' };
}

/**
 * Find a wallet's most recent transaction by refId.
 *
 * Circle's CONTRACT_EXECUTION SDK callback doesn't surface the transactionId,
 * so we tag each challenge with a unique refId at create-time and look it up
 * here after the user signs. The SDK's listTransactions doesn't accept refId
 * as a server-side filter, so we list the most recent transactions and
 * match client-side. Returns null if no match yet (Circle may take a moment
 * to index a brand-new tx); caller should retry. The walletId fallback
 * grabs the most recent outbound CONTRACT_EXECUTION when refId isn't in
 * the response payload at all.
 */
export async function findTransactionByRefId(
  userToken: string,
  refId: string,
  walletId?: string,
): Promise<{
  id: string;
  state: string;
  txHash: string | null;
  matchedBy: 'refId' | 'walletId-fallback';
  candidates?: number;
} | null> {
  const c = getUserControlledClient();
  const res = await c.listTransactions({ userToken, pageSize: 20 });
  const txs = res.data?.transactions ?? [];
  // Primary: match by refId.
  for (const tx of txs) {
    const txRefId = (tx as { refId?: string }).refId;
    if (txRefId === refId) {
      return {
        id: tx.id ?? '',
        state: tx.state ?? 'UNKNOWN',
        txHash: tx.txHash ?? null,
        matchedBy: 'refId',
        candidates: txs.length,
      };
    }
  }
  // Fallback: if walletId is supplied and refId never matched (e.g. Circle
  // doesn't return refId on the list call), grab the most recent outbound
  // CONTRACT_EXECUTION for that wallet. Best-effort — assumes the user
  // hasn't kicked off other contract executions in the same window.
  if (walletId) {
    for (const tx of txs) {
      const txAny = tx as {
        walletId?: string;
        operation?: string;
        transactionType?: string;
      };
      if (
        txAny.walletId === walletId &&
        txAny.operation === 'CONTRACT_EXECUTION' &&
        (txAny.transactionType === 'OUTBOUND' || !txAny.transactionType)
      ) {
        return {
          id: tx.id ?? '',
          state: tx.state ?? 'UNKNOWN',
          txHash: tx.txHash ?? null,
          matchedBy: 'walletId-fallback',
          candidates: txs.length,
        };
      }
    }
  }
  return null;
}
