'use client';

import { useState, useRef, useEffect } from 'react';
import { useDisconnect } from 'wagmi';
import { ConnectKitButton } from 'connectkit';
import { useCaliberWallet } from '@/lib/wallet/useCaliberWallet';
import { useCircleAuth } from '@/lib/circle/AuthContext';

/* ──────────────────────────────────────────────────────────────────────────
 * ConnectButton — single wallet button for the site header.
 *
 *   Not connected  →  "Connect wallet"  → modal picker (MetaMask / Google)
 *   Connected      →  "0x12…45 · MetaMask"  → dropdown (Disconnect, Switch)
 *
 * Replaces the bare ConnectKitButton in Nav and the orange Circle panel
 * on /jobs/new. Single source of truth for wallet status across the site.
 * ────────────────────────────────────────────────────────────────────────── */

export function ConnectButton() {
  const wallet = useCaliberWallet();
  const circle = useCircleAuth();
  const { disconnect: disconnectWagmi } = useDisconnect();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const autoCreateAttempted = useRef(false);

  // Local UI state for the auto-create-wallet flow.
  const [autoCreateState, setAutoCreateState] = useState<
    'idle' | 'initializing' | 'executing' | 'refreshing' | 'funding' | 'done' | 'error'
  >('idle');
  const [autoCreateError, setAutoCreateError] = useState<string | null>(null);

  // D2: judge-demo funded wallet drip.
  const [fundState, setFundState] = useState<
    | { kind: 'idle' }
    | { kind: 'pending' }
    | { kind: 'funded'; amount: string; txHash: string; alreadyFunded: boolean }
    | { kind: 'unavailable'; faucetUrl: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const fundAttempted = useRef(false);

  // After Google / Email sign-in: session exists but no wallet yet → kick off
  // the initialize-user challenge. Circle SDK opens a confirmation modal for
  // the user, then the wallet is created. Runs once per session.
  useEffect(() => {
    if (
      circle.session &&
      !circle.session.wallet &&
      !autoCreateAttempted.current &&
      !circle.pending &&
      autoCreateState === 'idle'
    ) {
      autoCreateAttempted.current = true;
      (async () => {
        try {
          setAutoCreateState('initializing');
          setAutoCreateError(null);
          const challengeId = await circle.createWalletChallenge();
          if (challengeId === null) {
            // user was already initialized — just refresh wallet info
            setAutoCreateState('refreshing');
            await circle.refresh();
            setAutoCreateState('done');
            return;
          }
          setAutoCreateState('executing');
          const result = await circle.runChallenge(challengeId);
          if (!result.ok) {
            throw new Error(result.errorMessage ?? 'challenge execution failed');
          }
          setAutoCreateState('refreshing');
          await new Promise((r) => setTimeout(r, 1500));
          await circle.refresh();
          setAutoCreateState('done');
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'auto-create failed';
          setAutoCreateError(msg);
          setAutoCreateState('error');
        }
      })();
    }
    if (!circle.session) {
      autoCreateAttempted.current = false;
      setAutoCreateState('idle');
      setAutoCreateError(null);
      fundAttempted.current = false;
      setFundState({ kind: 'idle' });
    }
  }, [circle, autoCreateState]);

  // D2: drip test USDC to the freshly-created Circle wallet so the judge can
  // walk the gated-job demo without visiting Circle's faucet. Runs once per
  // wallet address. Server-side endpoint is idempotent on address — repeat
  // calls return the original txHash.
  useEffect(() => {
    if (
      wallet.isConnected &&
      wallet.type === 'circle' &&
      wallet.address &&
      !fundAttempted.current &&
      fundState.kind === 'idle'
    ) {
      fundAttempted.current = true;
      setFundState({ kind: 'pending' });
      (async () => {
        try {
          const r = await fetch('/api/circle/fund-wallet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: wallet.address }),
          });
          const data = await r.json();
          if (r.status === 503) {
            setFundState({
              kind: 'unavailable',
              faucetUrl: data.faucetUrl ?? 'https://faucet.circle.com',
            });
            return;
          }
          if (!r.ok) {
            setFundState({ kind: 'error', message: data.message ?? 'funding failed' });
            return;
          }
          setFundState({
            kind: 'funded',
            amount: data.amount,
            txHash: data.txHash,
            alreadyFunded: !!data.alreadyFunded,
          });
        } catch (err) {
          setFundState({
            kind: 'error',
            message: err instanceof Error ? err.message : 'funding failed',
          });
        }
      })();
    }
  }, [wallet.isConnected, wallet.type, wallet.address, fundState.kind]);

  // Close menu when clicking outside.
  useEffect(() => {
    if (!menuOpen && !pickerOpen) return;
    function onDoc(e: MouseEvent) {
      if (!dropdownRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
        setPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen, pickerOpen]);

  // Connected: show address + brand + dropdown menu.
  if (wallet.isConnected && wallet.address) {
    const short = `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`;
    const showFundChip =
      wallet.type === 'circle' &&
      (fundState.kind === 'pending' || fundState.kind === 'funded');
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="aa-btn aa-btn--primary text-xs"
          title={wallet.email ?? wallet.address}
        >
          <span className="font-mono">{short}</span>
          <span className="ml-1.5 text-[10px] opacity-70">· {wallet.label}</span>
          {showFundChip && (
            <span
              className={`ml-1.5 text-[10px] px-1 py-0.5 rounded-sm ${
                fundState.kind === 'funded'
                  ? 'bg-[var(--color-signal-up)]/15 text-[var(--color-signal-up)]'
                  : 'bg-[var(--color-copper)]/15 text-[var(--color-copper)] animate-pulse'
              }`}
              title={fundState.kind === 'funded' ? 'test USDC funded' : 'funding test wallet…'}
            >
              {fundState.kind === 'funded' ? `+$${fundState.amount}` : '$…'}
            </span>
          )}
        </button>
        {menuOpen && (
          <div className="absolute right-0 mt-2 w-72 bg-white border border-[var(--color-hairline)] rounded-[2px] shadow-lg z-50">
            {wallet.email && (
              <div className="px-3 py-2 border-b border-[var(--color-hairline)] text-[11px] font-mono text-[var(--color-mute)] break-all">
                {wallet.email}
              </div>
            )}
            <div className="px-3 py-2 text-[11px] font-mono text-[var(--color-mute)] break-all border-b border-[var(--color-hairline)]">
              {wallet.address}
            </div>
            {wallet.type === 'circle' && (
              <div className="px-3 py-2 border-b border-[var(--color-hairline)] text-[11px]">
                {fundState.kind === 'pending' && (
                  <span className="text-[var(--color-copper)] font-mono">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse mr-1.5" />
                    funding test wallet…
                  </span>
                )}
                {fundState.kind === 'funded' && (
                  <div className="space-y-0.5">
                    <div className="text-[var(--color-signal-up)] font-mono">
                      ✓ ${fundState.amount} USDC{' '}
                      {fundState.alreadyFunded ? '(prev funded)' : 'funded'}
                    </div>
                    <a
                      href={`https://testnet.arcscan.app/tx/${fundState.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-mono text-[var(--color-mute)] hover:underline break-all"
                    >
                      {fundState.txHash.slice(0, 10)}…
                    </a>
                  </div>
                )}
                {fundState.kind === 'unavailable' && (
                  <a
                    href={fundState.faucetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--color-copper)] underline font-mono"
                  >
                    fund with Circle faucet →
                  </a>
                )}
                {fundState.kind === 'error' && (
                  <span className="text-[var(--color-signal-down)] font-mono">
                    funding failed: {fundState.message.slice(0, 60)}
                  </span>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(wallet.address!);
                setMenuOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-[var(--color-bg-elev)]"
            >
              copy address
            </button>
            <button
              type="button"
              onClick={() => {
                if (wallet.type === 'metamask') disconnectWagmi();
                if (wallet.type === 'circle') circle.signOut();
                setMenuOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-[var(--color-bg-elev)] text-[var(--color-signal-down)] border-t border-[var(--color-hairline)]"
            >
              disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  // Not yet connected, but we're in the middle of a flow — show progress
  // instead of the default "connect wallet" label. Three scenarios:
  //   - circle.pending: SDK still verifying the Google OAuth response
  //   - autoCreateState !== idle/done: creating the wallet via challenge
  const inFlight =
    circle.pending ||
    (autoCreateState !== 'idle' && autoCreateState !== 'done' && autoCreateState !== 'error');
  const flightLabel = circle.pending
    ? 'completing sign-in…'
    : autoCreateState === 'initializing'
      ? 'creating wallet…'
      : autoCreateState === 'executing'
        ? 'confirm wallet creation…'
        : autoCreateState === 'refreshing'
          ? 'loading wallet…'
          : 'connect wallet';

  // Not connected: show "Connect wallet" + picker modal.
  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setPickerOpen((v) => !v)}
        disabled={inFlight}
        className="aa-btn aa-btn--primary disabled:opacity-70 disabled:cursor-wait"
      >
        {inFlight ? (
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-2 h-2 rounded-full bg-current opacity-70 animate-pulse"
              aria-hidden="true"
            />
            {flightLabel}
          </span>
        ) : (
          'connect wallet'
        )}
      </button>
      {pickerOpen && (
        <div className="absolute right-0 mt-2 w-72 bg-white border border-[var(--color-hairline)] rounded-[2px] shadow-lg z-50 p-3 space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.05em] text-[var(--color-mute)] mb-1">
            choose a wallet
          </p>

          {/* MetaMask / any EIP-1193 wallet via ConnectKit */}
          <ConnectKitButton.Custom>
            {({ show }) => (
              <button
                type="button"
                onClick={() => {
                  show?.();
                  setPickerOpen(false);
                }}
                className="w-full text-left px-3 py-2 border border-[var(--color-hairline)] hover:border-[var(--color-ink)] rounded-[2px] text-sm transition"
              >
                <div className="font-medium">MetaMask · WalletConnect</div>
                <div className="text-[11px] text-[var(--color-mute)]">
                  Browser / mobile wallet. You sign each tx in your wallet.
                </div>
              </button>
            )}
          </ConnectKitButton.Custom>

          {/* Circle Programmable Wallets via Google (currently beta — known
              iframe-hang issue on some browsers). Kept as an option for users
              who want to try it, with a warning. */}
          <button
            type="button"
            onClick={async () => {
              setPickerOpen(false);
              await circle.signInWithGoogle();
            }}
            disabled={circle.unavailable || !circle.googleClientId || circle.pending}
            className="w-full text-left px-3 py-2 border border-[var(--color-hairline)] hover:border-[var(--color-ink)] rounded-[2px] text-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
            title="Powered by Circle Programmable Wallets"
          >
            <div className="font-medium">Sign in with Google</div>
            <div className="text-[11px] text-[var(--color-mute)]">
              {circle.unavailable
                ? 'unavailable — server not configured'
                : !circle.googleClientId
                  ? 'unavailable — Google Client ID missing'
                  : 'Wallet tied to Google. May hang on some browsers — use email if so.'}
            </div>
          </button>

          {/* Email OTP — bypasses OAuth iframe-hang issues entirely */}
          <EmailOption
            onStart={() => setPickerOpen(false)}
            disabled={circle.unavailable || circle.pending}
          />
          {/* Email mini-form is rendered inline below the picker buttons via state. */}

          {circle.pending && (
            <p className="text-[11px] font-mono text-[var(--color-copper)] text-center pt-1">
              completing google sign-in…
            </p>
          )}
          {circle.error && (
            <p className="text-[11px] text-[var(--color-signal-down)] text-center pt-1 break-words">
              {circle.error}
            </p>
          )}

          {/* Surface wallet-creation errors when the post-Google auto-create
              flow fails. The verbose debug + trace panels we used to track
              the OAuth flow are removed now that it's working. */}
          {autoCreateError && (
            <p className="text-[11px] text-[var(--color-signal-down)] text-center pt-1 break-words">
              wallet creation failed: {autoCreateError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Email entry mini-form — collapses to a single button by default. Click
 * expands an inline email input + submit. Calls circle.signInWithEmail()
 * which opens Circle's OTP modal.
 */
function EmailOption({ onStart, disabled }: { onStart: () => void; disabled: boolean }) {
  const circle = useCircleAuth();
  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState('');

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        disabled={disabled}
        className="w-full text-left px-3 py-2 border border-[var(--color-hairline)] hover:border-[var(--color-ink)] rounded-[2px] text-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
        title="Powered by Circle Programmable Wallets — email OTP"
      >
        <div className="font-medium">Sign in with Email</div>
        <div className="text-[11px] text-[var(--color-mute)]">
          One-time code to your inbox. Wallet tied to your email address.
        </div>
      </button>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!email.trim()) return;
        onStart();
        await circle.signInWithEmail(email.trim());
      }}
      className="border border-[var(--color-hairline)] rounded-[2px] p-2 space-y-1.5"
    >
      <p className="text-[11px] text-[var(--color-mute)]">Enter your email — we'll send a one-time code:</p>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="w-full px-2.5 py-1.5 bg-white border border-[var(--color-hairline)] rounded-[2px] text-sm focus:outline-none focus:border-[var(--color-ink)] font-mono"
        autoFocus
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!email.trim() || circle.pending}
          className="flex-1 py-1.5 px-2 bg-[var(--color-ink)] text-[var(--color-paper)] text-xs font-medium rounded-[2px] hover:bg-[#1c2028] disabled:opacity-50"
        >
          send code
        </button>
        <button
          type="button"
          onClick={() => { setExpanded(false); setEmail(''); }}
          className="px-2 py-1.5 text-xs text-[var(--color-mute)] hover:text-[var(--color-ink)]"
        >
          cancel
        </button>
      </div>
    </form>
  );
}

