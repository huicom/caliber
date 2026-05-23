'use client';

import { useAccount } from 'wagmi';
import { useCircleAuth } from '@/lib/circle/AuthContext';

/* ──────────────────────────────────────────────────────────────────────────
 * useCaliberWallet — unified wallet state across both signing paths.
 *
 *   MetaMask (via ConnectKit + wagmi)   ─┐
 *                                          ├─► useCaliberWallet → { address, type, ... }
 *   Circle Programmable Wallets (Google) ─┘
 *
 * Returns the active wallet regardless of provider. MetaMask takes
 * priority if both happen to be connected at once (very rare).
 *
 * Consumers (Nav ConnectButton, PostJobForm Hire button) read this once
 * and dispatch by `type` — no longer need to wire both paths separately.
 * ────────────────────────────────────────────────────────────────────────── */

export type WalletType = 'metamask' | 'circle' | null;

export interface CaliberWallet {
  address: `0x${string}` | null;
  type: WalletType;
  /** Either wallet connected. */
  isConnected: boolean;
  /** Display label like "MetaMask" or "Google" — short brand. */
  label: string | null;
  /** Email for Circle/Google sessions, null for MetaMask. */
  email: string | null;
  /** True after both providers have finished their initial probes. */
  isReady: boolean;
}

export function useCaliberWallet(): CaliberWallet {
  const wagmi = useAccount();
  const circle = useCircleAuth();

  if (wagmi.isConnected && wagmi.address) {
    return {
      address: wagmi.address as `0x${string}`,
      type: 'metamask',
      isConnected: true,
      label: 'MetaMask',
      email: null,
      isReady: true,
    };
  }
  if (circle.session?.wallet) {
    return {
      address: circle.session.wallet.address,
      type: 'circle',
      isConnected: true,
      label: 'Google',
      email: circle.session.email,
      isReady: circle.isReady,
    };
  }
  return {
    address: null,
    type: null,
    isConnected: false,
    label: null,
    email: null,
    isReady: !wagmi.isConnecting && circle.isReady,
  };
}
