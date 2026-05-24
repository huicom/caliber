'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPublicClient, http, decodeEventLog, type Abi } from 'viem';
import { arcTestnet } from '@/lib/wagmi/chains';
import { RATING_GATEWAY } from '@/lib/contracts/addresses';
import RatingGateway_ABI from '@/lib/contracts/abis/RatingGateway.json';

/* ──────────────────────────────────────────────────────────────────────────
 * UserControlledWalletPanel — Circle Programmable Wallets.
 *
 * Two auth methods, user picks on first visit:
 *   • Google Sign-In  — Google OAuth → Circle binds wallet to Google account
 *   • 6-digit PIN     — Cookie-derived Caliber user, secured by PIN
 *
 * After auth (either method): wallet is created on first run (challenge),
 * then USDC.approve + postGatedJob run via PIN-protected challenges (for
 * both auth methods — Google sets up the user, PIN secures each tx).
 *
 * Funding is still manual via https://faucet.circle.com — Arc Testnet has
 * no programmatic faucet.
 * ────────────────────────────────────────────────────────────────────────── */

interface FormData {
  title: string;
  description: string;
  budgetUsdc: string;
  minTier: 'Gold' | 'Silver' | 'Bronze' | 'Pending';
  minConfidence: 'high' | 'moderate' | 'low';
  targetAgentId: string;
  evaluatorAddress?: string;
  deadline?: string;
}

interface Props {
  getFormData: () => FormData | null;
}

interface Session {
  userId: string | null;
  userToken: string;
  encryptionKey: string | null;
  appId: string;
  googleClientId: string | null;
  wallet: { id: string; address: `0x${string}`; blockchain: string } | null;
  authMethod: 'pin' | 'google';
}

type Step =
  | 'idle' // auth picker
  | 'authenticating'
  | 'needs_wallet'
  | 'creating_wallet'
  | 'ready'
  | 'running_approve'
  | 'running_post'
  | 'success'
  | 'error';

type W3SSdkType = {
  execute: (
    challengeId: string,
    onCompleted?: (error: { message?: string } | undefined, result: unknown) => void,
  ) => void;
  setAuthentication: (auth: { userToken: string; encryptionKey: string }) => void;
  updateConfigs: (
    configs: unknown,
    onLoginComplete?: (error: { message?: string } | undefined, result: unknown) => void,
  ) => void;
  performLogin: (provider: 'Google' | 'Apple' | 'Facebook') => void;
  getDeviceId: () => Promise<string>;
};

type LoginCallback = (
  error: { message?: string } | undefined,
  result: unknown,
) => Promise<void> | void;

interface SocialLoginResult {
  userToken: string;
  encryptionKey: string;
  refreshToken?: string;
  oAuthInfo?: {
    provider?: string;
    socialUserInfo?: { email?: string; name?: string };
  };
}

export function UserControlledWalletPanel({ getFormData }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('idle');
  const [session, setSession] = useState<Session | null>(null);
  const [oauthEmail, setOauthEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string>('pick a sign-in method');
  const [resultLinks, setResultLinks] = useState<{
    approveTxHash?: string | null;
    postTxHash?: string | null;
    jobId?: string | null;
  } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const sdkRef = useRef<W3SSdkType | null>(null);

  // ───── lazy-load SDK + fetch googleClientId on mount ─────────────────────
  // Important: the SDK calls execSocialLoginStatusCheck() automatically in
  // its constructor. If the page just loaded post-Google-redirect, the SDK
  // detects the OAuth fragment in window.location.hash and fires the
  // onLoginComplete callback. So onLoginComplete MUST be wired into the
  // constructor here, not added later via updateConfigs() — otherwise the
  // callback is undefined when the SDK auto-fires it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('@circle-fin/w3s-pw-web-sdk');
        if (cancelled) return;
        const W3SSdk = (mod as {
          W3SSdk: new (configs: unknown, onLoginComplete?: LoginCallback) => W3SSdkType;
        }).W3SSdk;

        const probe = await fetch('/api/circle/uc/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ probe: true }),
        });
        if (probe.status === 503) {
          setUnavailable(true);
          setStep('error');
          setError('Circle App ID is not configured on the server.');
          return;
        }
        if (!probe.ok) throw new Error(`session probe returned ${probe.status}`);
        const sess = (await probe.json()) as Session;

        // Detect post-redirect state — URL hash has OAuth fragment + localStorage
        // has the provider tag saved by performGoogleLogin before the redirect.
        const isPostRedirect =
          typeof window !== 'undefined' &&
          /^#[a-zA-Z0-9-_.%=&]+$/.test(window.location.hash) &&
          window.localStorage.getItem('socialLoginProvider') === 'Google';

        sdkRef.current = new W3SSdk(
          { appSettings: { appId: sess.appId } },
          onSocialLoginComplete,
        );
        setGoogleClientId(sess.googleClientId);

        if (isPostRedirect) {
          setStep('authenticating');
          setStatusText('completing google sign-in…');
          // SDK auto-fires onSocialLoginComplete; we just wait.
        } else {
          setStep('idle');
          setStatusText('sign in to create or recover your wallet');
        }
      } catch (err) {
        if (!cancelled) {
          setStep('error');
          setError(err instanceof Error ? err.message : 'init failed');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // onSocialLoginComplete is a stable callback reference (defined below
    // with useCallback) — including it would re-run the effect needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stable callback the SDK auto-fires after Google OAuth redirect-back
  // OR after a user-initiated performLogin during the current page life.
  const onSocialLoginComplete = useCallback<LoginCallback>(
    async (err, result) => {
      if (err) {
        setError(err.message ?? 'google sign-in failed');
        setStep('error');
        return;
      }
      const r = result as SocialLoginResult;
      if (!r?.userToken || !r?.encryptionKey) {
        setError('google sign-in returned no userToken');
        setStep('error');
        return;
      }
      sdkRef.current?.setAuthentication({
        userToken: r.userToken,
        encryptionKey: r.encryptionKey,
      });
      if (r.oAuthInfo?.socialUserInfo?.email) {
        setOauthEmail(r.oAuthInfo.socialUserInfo.email);
      }
      try {
        const sessRes = await fetch('/api/circle/uc/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userToken: r.userToken }),
        });
        if (!sessRes.ok) throw new Error(`session returned ${sessRes.status}`);
        const sess = (await sessRes.json()) as Session;
        const merged: Session = { ...sess, encryptionKey: r.encryptionKey };
        setSession(merged);
        if (sess.wallet) {
          setStep('ready');
          setStatusText(
            `wallet ready · ${sess.wallet.address.slice(0, 10)}…${sess.wallet.address.slice(-6)}`,
          );
        } else {
          setStep('needs_wallet');
          setStatusText('signed in · create wallet to continue');
        }
        // Clean the OAuth fragment off the URL so refresh doesn't re-trigger
        // the auto-detect path.
        if (typeof window !== 'undefined' && window.location.hash) {
          history.replaceState(null, '', window.location.pathname + window.location.search);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'session hydrate failed');
        setStep('error');
      }
    },
    [],
  );

  // ───── Google auth — kicks off full-page redirect to Google ───────────
  // The actual callback handling lives in onSocialLoginComplete (attached
  // at SDK construction so it survives the redirect-back).
  const handleGoogleAuth = useCallback(async () => {
    if (!sdkRef.current) return;
    if (!googleClientId) {
      setError('NEXT_PUBLIC_GOOGLE_CLIENT_ID not set on server.');
      setStep('error');
      return;
    }
    setStep('authenticating');
    setStatusText('redirecting to google…');
    setError(null);

    try {
      const deviceId = await sdkRef.current.getDeviceId();
      const dtRes = await fetch('/api/circle/uc/device-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });
      if (!dtRes.ok) {
        const b = await dtRes.json().catch(() => ({}));
        throw new Error(b.message ?? `device-token returned ${dtRes.status}`);
      }
      const { deviceToken, deviceEncryptionKey } = (await dtRes.json()) as {
        deviceToken: string;
        deviceEncryptionKey: string;
      };

      const redirectUri = `${window.location.origin}${window.location.pathname}`;
      sdkRef.current.updateConfigs({
        loginConfigs: {
          deviceToken,
          deviceEncryptionKey,
          google: {
            clientId: googleClientId,
            redirectUri,
            // CRITICAL: SDK defaults to prompt=none (silent OAuth) which
            // fails with interaction_required when user needs to consent
            // or pick an account. select_account makes Google always show
            // the chooser — robust, works without prior browser session.
            selectAccountPrompt: true,
          },
        },
      });

      sdkRef.current.performLogin('Google');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'google auth failed');
      setStep('error');
    }
  }, [googleClientId]);

  // ───── create wallet (post-auth) ─────────────────────────────────────────
  const refreshSession = useCallback(async (userToken?: string): Promise<Session | null> => {
    const tokenToUse = userToken ?? session?.userToken;
    if (!tokenToUse) return null;
    const isGoogle = session?.authMethod === 'google';
    const sessRes = await fetch('/api/circle/uc/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isGoogle ? { userToken: tokenToUse } : {}),
    });
    if (!sessRes.ok) return null;
    const sess = (await sessRes.json()) as Session;
    // Preserve encryptionKey for Google sessions (server doesn't return it).
    const merged: Session = isGoogle && session?.encryptionKey
      ? { ...sess, encryptionKey: session.encryptionKey }
      : sess;
    setSession(merged);
    return merged;
  }, [session]);

  const handleCreateWallet = useCallback(async () => {
    if (!session || !sdkRef.current) return;
    setError(null);
    setStep('creating_wallet');
    setStatusText('opening wallet/PIN setup…');
    try {
      const res = await fetch('/api/circle/uc/wallet-challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userToken: session.userToken }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `wallet-challenge returned ${res.status}`);
      }
      const { challengeId } = (await res.json()) as { challengeId: string };
      sdkRef.current.execute(challengeId, async (err) => {
        if (err) {
          setError(err.message ?? 'wallet setup cancelled');
          setStep('error');
          return;
        }
        for (let i = 0; i < 10; i++) {
          await new Promise((r) => setTimeout(r, 2_000));
          const sess = await refreshSession();
          if (sess?.wallet) {
            setStep('ready');
            setStatusText(
              `wallet ready · ${sess.wallet.address.slice(0, 10)}…${sess.wallet.address.slice(-6)}`,
            );
            return;
          }
        }
        setError('wallet created but not visible — try refreshing the page');
        setStep('error');
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create wallet failed');
      setStep('error');
    }
  }, [session, refreshSession]);

  // ───── demo flow (approve → post → redirect) ─────────────────────────────
  const handleDemo = useCallback(async () => {
    const form = getFormData();
    if (!form) {
      setError('Fill the form above first — title, description, budget, agent.');
      setStep('error');
      return;
    }
    if (!session?.wallet || !sdkRef.current) {
      setError('wallet not ready');
      setStep('error');
      return;
    }
    setError(null);
    setResultLinks(null);

    try {
      setStep('running_approve');
      setStatusText('PIN: approve USDC to gateway…');
      const approveRes = await fetch('/api/circle/uc/approve-challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userToken: session.userToken,
          walletId: session.wallet.id,
          budgetUsdc: form.budgetUsdc,
        }),
      });
      if (!approveRes.ok) {
        const body = await approveRes.json().catch(() => ({}));
        throw new Error(body.message ?? `approve-challenge returned ${approveRes.status}`);
      }
      const { challengeId: approveChallengeId } = (await approveRes.json()) as {
        challengeId: string;
      };
      const approveResult = await runChallenge(sdkRef.current, approveChallengeId);
      if (approveResult.errorMessage) throw new Error(`approve: ${approveResult.errorMessage}`);
      setResultLinks((p) => ({ ...(p ?? {}), approveTxHash: approveResult.txHash }));

      setStep('running_post');
      setStatusText('PIN: post gated job…');
      const postRes = await fetch('/api/circle/uc/post-job-challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userToken: session.userToken,
          walletId: session.wallet.id,
          posterAddress: session.wallet.address,
          ...form,
        }),
      });
      if (!postRes.ok) {
        const body = await postRes.json().catch(() => ({}));
        throw new Error(
          body.detail ?? body.reason ?? body.message ?? `post-challenge returned ${postRes.status}`,
        );
      }
      const { challengeId: postChallengeId } = (await postRes.json()) as { challengeId: string };
      const postResult = await runChallenge(sdkRef.current, postChallengeId);
      if (postResult.errorMessage) throw new Error(`post: ${postResult.errorMessage}`);
      setResultLinks((p) => ({ ...(p ?? {}), postTxHash: postResult.txHash }));

      // Parse receipt for jobId
      setStatusText('reading on-chain receipt…');
      let jobId: string | null = null;
      if (postResult.txHash) {
        try {
          const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
          const receipt = await publicClient.waitForTransactionReceipt({
            hash: postResult.txHash as `0x${string}`,
          });
          const gatewayLower = (RATING_GATEWAY as string).toLowerCase();
          for (const log of receipt.logs) {
            if (log.address.toLowerCase() !== gatewayLower) continue;
            try {
              const decoded = decodeEventLog({
                abi: RatingGateway_ABI as Abi,
                data: log.data,
                topics: log.topics,
              });
              if (decoded.eventName === 'JobPostedWithRating') {
                const args = decoded.args as unknown as { jobId: bigint };
                jobId = args.jobId.toString();
                break;
              }
            } catch {
              /* not our event */
            }
          }
        } catch {
          /* fallthrough */
        }
      }
      setResultLinks((p) => ({ ...(p ?? {}), jobId }));
      setStep('success');
      setStatusText('✓ job posted on chain');
      if (jobId) setTimeout(() => router.push(`/jobs/${jobId}`), 2_500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'demo failed');
      setStep('error');
    }
  }, [getFormData, session, router]);

  const inProgress =
    step === 'authenticating' ||
    step === 'creating_wallet' ||
    step === 'running_approve' ||
    step === 'running_post';

  return (
    <details
      className="border border-[var(--color-copper)]/30 bg-[#FFF7ED] rounded-[2px]"
      open={step !== 'idle' && step !== 'ready'}
    >
      <summary className="cursor-pointer px-5 py-3 flex items-baseline justify-between gap-3 flex-wrap hover:bg-[#FED7AA]/30 transition">
        <div className="space-y-0.5">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-copper)]">
            //circle_programmable_wallets · demo without metamask
          </p>
          <p className="text-sm text-[var(--color-ink)]">
            <strong>For judges without a wallet.</strong> If you have MetaMask, use the form above —
            faster. This path provisions a persistent Caliber wallet via Google sign-in.
          </p>
        </div>
        <span className="font-mono text-[10px] text-[var(--color-mute)]">
          {step === 'idle' ? 'click to expand ▾' : statusText}
        </span>
      </summary>

      <div className="px-5 pb-5 space-y-3 border-t border-[var(--color-copper)]/20">
        {unavailable && (
          <div className="border-l-2 border-[var(--color-copper)] bg-white px-3 py-2 text-xs">
            <p className="text-[var(--color-ink)]">
              <strong>demo unavailable:</strong> server missing{' '}
              <code className="font-mono">CIRCLE_API_KEY</code> or{' '}
              <code className="font-mono">NEXT_PUBLIC_CIRCLE_APP_ID</code>.
            </p>
          </div>
        )}

        {error && !unavailable && (
          <div className="border-l-2 border-[var(--color-signal-down)] bg-white px-3 py-2 text-xs text-[var(--color-signal-down)] break-words">
            {error}
          </div>
        )}

        {/* === Sign in (Google only) ===================================== */}
        {step === 'idle' && !unavailable && (
          <div className="space-y-2">
            <p className="text-xs text-[var(--color-mute)] leading-relaxed">
              Your Caliber demo wallet is bound to your Google account. Sign in from any browser
              or device with the same Google → same wallet, every time. No seed phrase, no
              extension.
            </p>
            <button
              type="button"
              onClick={handleGoogleAuth}
              disabled={!googleClientId}
              className="w-full px-4 py-3 bg-white border border-[var(--color-ink)] hover:bg-[var(--color-bg-elev)] rounded-[2px] text-sm font-medium text-[var(--color-ink)] disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.92a8.78 8.78 0 0 0 2.68-6.61z" />
                <path fill="#34A853" d="M9 18c2.43 0 4.46-.8 5.96-2.18l-2.92-2.26a5.4 5.4 0 0 1-8.06-2.83H.96v2.33A9 9 0 0 0 9 18z" />
                <path fill="#FBBC05" d="M3.96 10.71a5.4 5.4 0 0 1 0-3.43V4.95H.96a9 9 0 0 0 0 8.1l3-2.34z" />
                <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3 2.33A5.4 5.4 0 0 1 9 3.58z" />
              </svg>
              {googleClientId ? 'sign in with Google' : 'sign in with Google (not configured)'}
            </button>
            {!googleClientId && (
              <p className="text-[10px] text-[var(--color-mute)] font-mono text-center">
                server missing NEXT_PUBLIC_GOOGLE_CLIENT_ID
              </p>
            )}
          </div>
        )}

        {/* === Signed in, no wallet yet ================================== */}
        {step === 'needs_wallet' && session && (
          <div className="space-y-2">
            {oauthEmail && (
              <p className="text-xs text-[var(--color-mute)]">
                signed in as <strong>{oauthEmail}</strong>
              </p>
            )}
            <p className="text-xs text-[var(--color-mute)] leading-relaxed">
              Now set up a 6-digit PIN. It secures each transaction (used alongside Google sign-in).
              Your wallet is created at the same time and persists with your Google account.
            </p>
            <button
              type="button"
              onClick={handleCreateWallet}
              className="w-full py-2.5 px-4 bg-[var(--color-copper)] text-white text-sm font-medium rounded-[2px] hover:opacity-90"
            >
              set PIN + create wallet
            </button>
          </div>
        )}

        {/* === Wallet ready (and during/after demo) ====================== */}
        {(step === 'ready' || step === 'success' || step === 'running_approve' || step === 'running_post' || (step === 'error' && session?.wallet)) && session?.wallet && (
          <>
            <div className="bg-[var(--color-bg-elev)] border border-[var(--color-hairline)] rounded-[2px] px-2.5 py-2 text-xs font-mono">
              <div className="flex items-baseline justify-between gap-2 mb-0.5">
                <span className="text-[10px] text-[var(--color-mute)] uppercase tracking-[0.05em]">
                  your circle wallet · auth: {session.authMethod}
                  {oauthEmail && ` · ${oauthEmail}`}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    // Reset to the auth picker so the user can pick a
                    // different method (e.g. PIN → Google). Doesn't delete
                    // the existing wallet — picking the same method again
                    // brings it back.
                    setSession(null);
                    setOauthEmail(null);
                    setResultLinks(null);
                    setError(null);
                    setStep('idle');
                    setStatusText('pick a sign-in method');
                  }}
                  className="text-[10px] text-[var(--color-copper)] hover:underline normal-case tracking-normal"
                  title="Switch to a different sign-in method (Google ↔ PIN)"
                >
                  switch sign-in →
                </button>
              </div>
              <div className="text-[var(--color-ink)] break-all">{session.wallet.address}</div>
              <div className="mt-1 flex flex-wrap gap-2">
                <a
                  href="https://faucet.circle.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-[var(--color-copper)] hover:underline"
                >
                  fund via faucet.circle.com →
                </a>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(session.wallet!.address)}
                  className="text-[10px] text-[var(--color-copper)] hover:underline"
                >
                  copy address
                </button>
              </div>
            </div>

            <p className="text-xs text-[var(--color-mute)] leading-relaxed">
              Fill the form above. Click below — Circle SDK will prompt for PIN twice
              (USDC.approve, then postGatedJob).
            </p>
            <button
              type="button"
              onClick={handleDemo}
              disabled={inProgress}
              className="w-full py-2.5 px-4 bg-[var(--color-copper)] text-white text-sm font-medium rounded-[2px] hover:opacity-90 disabled:opacity-50"
            >
              {inProgress ? statusText : 'run demo (PIN-protected)'}
            </button>
          </>
        )}

        {inProgress && (
          <div className="border-l-2 border-[var(--color-copper)] bg-white px-3 py-2 text-xs text-[var(--color-copper)] font-mono">
            {statusText}
          </div>
        )}

        {resultLinks && (resultLinks.approveTxHash || resultLinks.postTxHash) && (
          <div className="border-l-2 border-[var(--color-signal-up)] bg-white px-3 py-2 text-xs space-y-1 font-mono">
            {resultLinks.approveTxHash && (
              <p>
                approve ·{' '}
                <a
                  href={`https://testnet.arcscan.app/tx/${resultLinks.approveTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--color-copper)] hover:underline"
                >
                  {resultLinks.approveTxHash.slice(0, 12)}…
                </a>
              </p>
            )}
            {resultLinks.postTxHash && (
              <p>
                postGatedJob ·{' '}
                <a
                  href={`https://testnet.arcscan.app/tx/${resultLinks.postTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--color-copper)] hover:underline"
                >
                  {resultLinks.postTxHash.slice(0, 12)}…
                </a>
              </p>
            )}
            {resultLinks.jobId && (
              <p className="text-[var(--color-ink)] font-sans">
                redirecting to <code className="font-mono">/jobs/{resultLinks.jobId}</code>…
              </p>
            )}
          </div>
        )}

        <p className="text-[10px] text-[var(--color-mute)] font-mono leading-relaxed">
          chain: ARC-TESTNET · custody: user-controlled · auth: {session?.authMethod ?? '—'} · gas:
          usdc-native ·{' '}
          <a
            href="https://developers.circle.com/wallets/user-controlled/web-sdk"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--color-copper)] hover:underline"
          >
            circle docs ↗
          </a>
        </p>
      </div>
    </details>
  );
}

function runChallenge(sdk: W3SSdkType, challengeId: string): Promise<{
  ok: boolean;
  txHash: string | null;
  errorMessage: string | null;
}> {
  return new Promise((resolve) => {
    sdk.execute(challengeId, (error, result) => {
      if (error) {
        resolve({ ok: false, txHash: null, errorMessage: error.message ?? 'challenge failed' });
        return;
      }
      const r = result as { txHash?: string | null; transactionHash?: string | null } | undefined;
      const txHash = r?.txHash ?? r?.transactionHash ?? null;
      resolve({ ok: true, txHash, errorMessage: null });
    });
  });
}
