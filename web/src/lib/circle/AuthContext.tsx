'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/* ──────────────────────────────────────────────────────────────────────────
 * Cookie helpers — Circle's quickstart uses cookies-next to persist
 * loginConfigs across the Google OAuth full-page redirect. Without these,
 * the SDK reconstructs post-redirect without the deviceToken /
 * deviceEncryptionKey it needs to verify the OAuth response → verify-token
 * iframe hangs. Plain document.cookie is enough; no dependency needed.
 * ────────────────────────────────────────────────────────────────────────── */
const COOKIE_DAYS = 1; // tokens are short-lived; only need to survive the round-trip
function setCookie(name: string, value: string) {
  if (typeof document === 'undefined') return;
  const exp = new Date(Date.now() + COOKIE_DAYS * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${exp}; path=/; SameSite=Lax`;
}
function getCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : '';
}
function deleteCookie(name: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}

/* ──────────────────────────────────────────────────────────────────────────
 * CircleAuthContext — global state for the Circle Programmable Wallets path.
 *
 * Lives at the root of the React tree (above pages). Reads its own session
 * on mount via /api/circle/uc/session (probe mode, no auth), constructs the
 * W3S SDK once with an onSocialLoginComplete handler that survives Google
 * redirect-backs, and exposes a small API for the rest of the app:
 *
 *   const { isReady, session, signInWithGoogle, signOut, runChallenge } = useCircleAuth();
 *
 * Used by:
 *   - <ConnectButton /> in the Nav (renders address + brand if logged in)
 *   - PostJobForm Hire button (dispatches the gated-job flow via runChallenge)
 *
 * SDK is loaded lazily (`import('@circle-fin/w3s-pw-web-sdk')`) to keep it
 * out of the SSR bundle. While loading, isReady=false and signIn is a no-op.
 * ────────────────────────────────────────────────────────────────────────── */

export interface CircleWallet {
  id: string;
  address: `0x${string}`;
  blockchain: string;
}

export interface CircleSession {
  userToken: string;
  encryptionKey: string;
  wallet: CircleWallet | null;
  email: string | null;
}

interface CircleAuthState {
  /** True after probe + SDK lazy-load complete. */
  isReady: boolean;
  /** Server reports the feature is disabled (missing env vars). */
  unavailable: boolean;
  appId: string | null;
  googleClientId: string | null;
  /** Non-null when user has authenticated. */
  session: CircleSession | null;
  /** Set during sign-in / wallet creation; useful for spinners. */
  pending: boolean;
  error: string | null;
  /** Diagnostic trail of SDK lifecycle events — visible in the debug panel. */
  trace: string[];
  signInWithGoogle: () => Promise<void>;
  /** Email OTP flow — opens Circle's modal for entering the emailed code. */
  signInWithEmail: (email: string) => Promise<void>;
  signOut: () => void;
  /** Returns a wallet-create challenge id, or null if user is already initialized
   *  (in which case just refresh() to load existing wallet info). */
  createWalletChallenge: () => Promise<string | null>;
  /** Returns the contract-execution challenge id for a USDC.approve(gateway,budget). */
  approveChallenge: (budgetUsdc: string) => Promise<string>;
  /** Returns the contract-execution challenge id for a postGatedJob call. */
  postJobChallenge: (form: PostJobInput) => Promise<{ challengeId: string; draftHash: string }>;
  /** Wraps sdk.execute as a Promise — resolves with txHash on success. */
  runChallenge: (challengeId: string) => Promise<{ ok: boolean; txHash: string | null; errorMessage: string | null }>;
  /** Re-fetches wallet info from server. */
  refresh: () => Promise<void>;
}

export interface PostJobInput {
  title: string;
  description: string;
  budgetUsdc: string;
  minTier: 'Established' | 'Proven' | 'Emerging' | 'Provisional';
  minConfidence: 'high' | 'moderate' | 'low';
  targetAgentId: string;
  evaluatorAddress?: string;
  deadline?: string;
}

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
  verifyOtp: () => void;
  setOnResendOtpEmail: (handler: () => void | Promise<void>) => void;
  getDeviceId: () => Promise<string>;
};

interface SocialLoginResult {
  userToken: string;
  encryptionKey: string;
  oAuthInfo?: { socialUserInfo?: { email?: string } };
}

interface SessionResponse {
  userId: string | null;
  userToken: string;
  encryptionKey: string | null;
  appId: string;
  googleClientId: string | null;
  wallet: CircleWallet | null;
  authMethod: 'pin' | 'google';
}

const CircleAuthContext = createContext<CircleAuthState | null>(null);

export function CircleAuthProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [appId, setAppId] = useState<string | null>(null);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [session, setSession] = useState<CircleSession | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trace, setTrace] = useState<string[]>([]);
  const sdkRef = useRef<W3SSdkType | null>(null);

  const log = useCallback((msg: string) => {
    const stamp = new Date().toISOString().slice(11, 19);
    setTrace((t) => [...t.slice(-9), `${stamp} ${msg}`]);
    if (typeof console !== 'undefined') console.log('[circle]', msg);
  }, []);

  const hydrateFromUserToken = useCallback(
    async (userToken: string, encryptionKey: string, email: string | null) => {
      const res = await fetch('/api/circle/uc/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userToken }),
      });
      if (!res.ok) throw new Error(`session hydrate failed: ${res.status}`);
      const data = (await res.json()) as SessionResponse;
      setSession({ userToken, encryptionKey, wallet: data.wallet, email });
      sdkRef.current?.setAuthentication({ userToken, encryptionKey });
    },
    [],
  );

  const onSocialLoginComplete = useCallback(
    async (err: { message?: string } | undefined, result: unknown) => {
      log(
        `callback fired · err=${err?.message ?? 'none'} · result=${
          result ? 'present' : 'null'
        }`,
      );
      if (err) {
        setError(err.message ?? 'google sign-in failed');
        setPending(false);
        return;
      }
      const r = result as SocialLoginResult;
      if (!r?.userToken || !r?.encryptionKey) {
        log(`callback got result but missing tokens · keys=${Object.keys(r ?? {}).join(',')}`);
        setError('google sign-in returned no userToken');
        setPending(false);
        return;
      }
      log(`callback got userToken (${r.userToken.length} chars) · hydrating…`);
      try {
        await hydrateFromUserToken(
          r.userToken,
          r.encryptionKey,
          r.oAuthInfo?.socialUserInfo?.email ?? null,
        );
        log(`hydrate ok · session set`);
        if (typeof window !== 'undefined' && window.location.hash) {
          history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        // Clean up cookies that were only needed for the round-trip
        deleteCookie('caliber_circle_deviceToken');
        deleteCookie('caliber_circle_deviceEncryptionKey');
        // Note: signal that the wallet-create flow should follow. The Connect
        // button handles execution because it needs the SDK ref + UI feedback.
        // We just mark pending=false here so the UI updates and the listener
        // (in ConnectButton) sees the new session and chains the next step.
        setPending(false);
      } catch (e) {
        log(`hydrate failed · ${e instanceof Error ? e.message : 'unknown'}`);
        setError(e instanceof Error ? e.message : 'session hydrate failed');
        setPending(false);
      }
    },
    [hydrateFromUserToken, log],
  );

  // Init on mount: probe server, lazy-load SDK, attach callback.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const probe = await fetch('/api/circle/uc/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ probe: true }),
        });
        if (probe.status === 503) {
          if (!cancelled) {
            setUnavailable(true);
            setIsReady(true);
          }
          return;
        }
        if (!probe.ok) throw new Error(`probe ${probe.status}`);
        const data = (await probe.json()) as SessionResponse;
        if (cancelled) return;
        setAppId(data.appId);
        setGoogleClientId(data.googleClientId);

        const mod = await import('@circle-fin/w3s-pw-web-sdk');
        if (cancelled) return;
        const W3SSdk = (mod as {
          W3SSdk: new (
            configs: unknown,
            onLoginComplete?: typeof onSocialLoginComplete,
          ) => W3SSdkType;
        }).W3SSdk;
        // CRITICAL per Circle quickstart: preload loginConfigs from cookies so
        // the SDK has deviceToken + deviceEncryptionKey + google config ready
        // when it auto-processes the OAuth hash post-redirect. Without these
        // restored, the verify-token iframe has nothing to verify with and
        // hangs forever.
        const restoredDeviceToken = getCookie('caliber_circle_deviceToken');
        const restoredDeviceEncryptionKey = getCookie('caliber_circle_deviceEncryptionKey');
        const initialConfig: Record<string, unknown> = {
          appSettings: { appId: data.appId },
          loginConfigs: {
            deviceToken: restoredDeviceToken,
            deviceEncryptionKey: restoredDeviceEncryptionKey,
            google: {
              clientId: data.googleClientId ?? '',
              redirectUri:
                typeof window !== 'undefined'
                  ? `${window.location.origin}${window.location.pathname}`
                  : '',
              selectAccountPrompt: true,
            },
          },
        };

        sdkRef.current = new W3SSdk(initialConfig, onSocialLoginComplete);
        log(
          `SDK constructed · appId=${data.appId.slice(0, 8)} · loginConfigs ${
            restoredDeviceToken ? 'restored from cookies' : 'empty (no prior redirect)'
          }`,
        );

        // The SDK's isValidHash allows :, /, etc. via [^&]* in value-side.
        // Our previous client check was too strict. Mirror the SDK's logic:
        // hash starts with # and contains at least one key=value pair.
        const hash = window.location.hash;
        const hasOAuthHash = hash.startsWith('#') && hash.includes('=');
        const provider = window.localStorage.getItem('socialLoginProvider');
        log(
          `post-redirect probe · hash=${hash ? 'present(' + hash.length + ' chars)' : 'empty'} · localStorage.provider=${provider ?? 'null'}`,
        );
        if (hasOAuthHash && provider === 'Google') {
          setPending(true);
          log(`detected post-Google-redirect state · awaiting SDK callback`);
        }

        setIsReady(true);
        log(`isReady · awaiting user action`);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'init failed');
          setIsReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!sdkRef.current || !googleClientId) {
      setError('google not configured');
      return;
    }
    setError(null);
    setPending(true);
    try {
      const deviceId = await sdkRef.current.getDeviceId();
      const dtRes = await fetch('/api/circle/uc/device-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });
      if (!dtRes.ok) throw new Error(`device-token ${dtRes.status}`);
      const { deviceToken, deviceEncryptionKey } = (await dtRes.json()) as {
        deviceToken: string;
        deviceEncryptionKey: string;
      };

      // CRITICAL: persist before redirect so the post-redirect SDK construction
      // can restore them. Without this, the verify-token iframe gets empty
      // tokens from parent and hangs.
      setCookie('caliber_circle_deviceToken', deviceToken);
      setCookie('caliber_circle_deviceEncryptionKey', deviceEncryptionKey);
      log(`signInWithGoogle · stored deviceToken in cookies`);

      const redirectUri = `${window.location.origin}${window.location.pathname}`;
      sdkRef.current.updateConfigs({
        loginConfigs: {
          deviceToken,
          deviceEncryptionKey,
          google: { clientId: googleClientId, redirectUri, selectAccountPrompt: true },
        },
      });
      sdkRef.current.performLogin('Google');
      // Page navigates to Google — no further code runs in this flow.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'google auth failed');
      setPending(false);
    }
  }, [googleClientId, log]);

  const signInWithEmail = useCallback(
    async (email: string) => {
      if (!sdkRef.current) {
        setError('SDK not ready');
        return;
      }
      setError(null);
      setPending(true);
      log(`email auth · requesting OTP for ${email}`);
      try {
        const deviceId = await sdkRef.current.getDeviceId();
        const dtRes = await fetch('/api/circle/uc/email-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId, email }),
        });
        if (!dtRes.ok) {
          const body = await dtRes.json().catch(() => ({}));
          throw new Error(body.message ?? `email-token ${dtRes.status}`);
        }
        const { deviceToken, deviceEncryptionKey, otpToken } = (await dtRes.json()) as {
          deviceToken: string;
          deviceEncryptionKey: string;
          otpToken: string;
        };
        log(`email auth · got otpToken, opening verify modal`);

        sdkRef.current.updateConfigs({
          loginConfigs: { deviceToken, deviceEncryptionKey, otpToken },
        });

        // Resend handler — if user clicks "send again" in the modal.
        sdkRef.current.setOnResendOtpEmail(async () => {
          try {
            await fetch('/api/circle/uc/email-resend', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ deviceId, email, otpToken }),
            });
            log(`email auth · OTP resent`);
          } catch (e) {
            log(`email auth · resend failed`);
          }
        });

        // Opens Circle's OTP entry modal. Verification + callback fire via
        // the onSocialLoginComplete attached at SDK construction.
        sdkRef.current.verifyOtp();
      } catch (e) {
        log(`email auth · failed: ${e instanceof Error ? e.message : 'unknown'}`);
        setError(e instanceof Error ? e.message : 'email auth failed');
        setPending(false);
      }
    },
    [log],
  );

  const signOut = useCallback(() => {
    setSession(null);
    setError(null);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('socialLoginProvider');
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch('/api/circle/uc/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userToken: session.userToken }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as SessionResponse;
      setSession({ ...session, wallet: data.wallet });
    } catch {
      // ignore
    }
  }, [session]);

  /**
   * Calls /v1/w3s/user/initialize (Circle's wallet bootstrap endpoint for
   * social-login users). Returns challengeId; caller runs runChallenge to
   * complete creation. Returns null when user is already initialized
   * (Circle error code 155106) so the caller can just refresh wallet info.
   */
  const createWalletChallenge = useCallback(async (): Promise<string | null> => {
    if (!session) throw new Error('not signed in');
    const res = await fetch('/api/circle/uc/initialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userToken: session.userToken }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.challengeId) {
      return body.challengeId as string;
    }
    if (body?.code === 155106) {
      // user already initialized — no challenge needed; refresh shows wallet
      log('initialize: user already initialized · refreshing wallet info');
      return null;
    }
    throw new Error(body?.message ?? `initialize returned ${res.status}`);
  }, [session, log]);

  const approveChallenge = useCallback(
    async (budgetUsdc: string) => {
      if (!session?.wallet) throw new Error('wallet not ready');
      const res = await fetch('/api/circle/uc/approve-challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userToken: session.userToken,
          walletId: session.wallet.id,
          budgetUsdc,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `approve-challenge ${res.status}`);
      }
      const { challengeId } = (await res.json()) as { challengeId: string };
      return challengeId;
    },
    [session],
  );

  const postJobChallenge = useCallback(
    async (form: PostJobInput) => {
      if (!session?.wallet) throw new Error('wallet not ready');
      const res = await fetch('/api/circle/uc/post-job-challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userToken: session.userToken,
          walletId: session.wallet.id,
          posterAddress: session.wallet.address,
          ...form,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? body.reason ?? body.message ?? `post-challenge ${res.status}`);
      }
      const { challengeId, draftHash } = (await res.json()) as {
        challengeId: string;
        draftHash: string;
      };
      return { challengeId, draftHash };
    },
    [session],
  );

  const runChallenge = useCallback(
    (challengeId: string): Promise<{ ok: boolean; txHash: string | null; errorMessage: string | null }> => {
      return new Promise((resolve) => {
        if (!sdkRef.current) {
          resolve({ ok: false, txHash: null, errorMessage: 'SDK not initialised' });
          return;
        }
        sdkRef.current.execute(challengeId, (err, result) => {
          if (err) {
            resolve({ ok: false, txHash: null, errorMessage: err.message ?? 'challenge failed' });
            return;
          }
          const r = result as { txHash?: string | null; transactionHash?: string | null } | undefined;
          const txHash = r?.txHash ?? r?.transactionHash ?? null;
          resolve({ ok: true, txHash, errorMessage: null });
        });
      });
    },
    [],
  );

  const value = useMemo<CircleAuthState>(
    () => ({
      isReady,
      unavailable,
      appId,
      googleClientId,
      session,
      pending,
      error,
      trace,
      signInWithGoogle,
      signInWithEmail,
      signOut,
      createWalletChallenge,
      approveChallenge,
      postJobChallenge,
      runChallenge,
      refresh,
    }),
    [
      isReady,
      unavailable,
      appId,
      googleClientId,
      session,
      pending,
      error,
      trace,
      signInWithGoogle,
      signInWithEmail,
      signOut,
      createWalletChallenge,
      approveChallenge,
      postJobChallenge,
      runChallenge,
      refresh,
    ],
  );

  return <CircleAuthContext.Provider value={value}>{children}</CircleAuthContext.Provider>;
}

export function useCircleAuth(): CircleAuthState {
  const ctx = useContext(CircleAuthContext);
  if (!ctx) throw new Error('useCircleAuth must be used inside <CircleAuthProvider>');
  return ctx;
}
