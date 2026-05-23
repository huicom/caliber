// Shared signing utilities for Caliber attestations (rating + transition).
// Both shapes use the same EIP-712 domain anchored to the deployed
// RatingVerifier contract, the same signer private key, and the same
// chain-id + verifying-contract mapping.

import { bytesToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const CHAIN_ID_MAP: Record<string, number> = {
  arc: 5042002,
  base: 8453,
};

export function stringToBytes32(str: string): `0x${string}` {
  const encoded = new TextEncoder().encode(str);
  const padded = new Uint8Array(32);
  padded.set(encoded.slice(0, 32));
  return bytesToHex(padded);
}

let _signerAccount: ReturnType<typeof privateKeyToAccount> | null = null;
export function getSigner() {
  const key = process.env.RATING_SIGNER_PRIVATE_KEY;
  if (!key) throw new Error('RATING_SIGNER_PRIVATE_KEY not set');
  if (!_signerAccount) {
    const pk = (key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`;
    _signerAccount = privateKeyToAccount(pk);
  }
  return _signerAccount;
}

export function caliberDomain(chain: string) {
  const verifyingContract = (process.env.RATING_VERIFIER_ADDRESS ||
    '0x0000000000000000000000000000000000000000') as `0x${string}`;
  const chainId = CHAIN_ID_MAP[chain] ?? 5042002;
  return {
    name: 'Caliber',
    version: '1',
    chainId,
    verifyingContract,
  };
}
