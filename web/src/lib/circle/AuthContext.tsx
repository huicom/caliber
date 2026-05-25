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
 *
 * Beyond the OAuth round-trip, we also persist the post-sign-in session
 * (userToken / encryptionKey / email) so a returning visitor doesn't have
 * to re-authenticate every page reload. userToken from Circle has a ~1h
 * server-side validity; we mirror that as the cookie max-age and gracefully
 * fall back to "signed out" if the rehydrate fails.
 * ────────────────────────────────────────────────────────────────────────── */
function setCookie(name: string, value: string, maxAgeSeconds = 60 * 60 * 24) {
  if (typeof document === 'undefined') return;
  const exp = new Date(Date.now() + maxAgeSeconds * 1000).toUTCString();
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

// Session storage — outlives a single page reload, matched to Circle's
// userToken ~1h validity. We mirror to BOTH cookies and localStorage so a
// browser quirk on either backend doesn't kill the demo. Restore tries
// cookies first, then localStorage. If hydrate fails (token expired
// Circle-side), the stale storage stays around — restore logs the error
// and falls back to the sign-in state, but a manual signOut wipes it
// cleanly.
const SESSION_KEY_USER_TOKEN = 'caliber_circle_userToken';
const SESSION_KEY_ENCRYPTION_KEY = 'caliber_circle_encryptionKey';
const SESSION_KEY_EMAIL = 'caliber_circle_email';
const SESSION_TTL_SECONDS = 60 * 60; // 1 hour

function saveSessionItem(key: string, value: string) {
  setCookie(key, value, SESSION_TTL_SECONDS);
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(key, value);
    }
  } catch {
    /* private mode / quota — fine, cookie covers us */
  }
}

function loadSessionItem(key: string): string {
  const cookieVal = getCookie(key);
  if (cookieVal) return cookieVal;
  try {
    if (typeof window !== 'undefined') {
      return window.localStorage.getItem(key) ?? '';
    }
  } catch {
    /* ignore */
  }
  return '';
}

function clearSessionItem(key: string) {
  deleteCookie(key);
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
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
  /** [Legacy] Creates a Circle CONTRACT_EXECUTION challenge for USDC.transfer
   *  to the x402 recipient. Used by the homegrown on-chain-proof x402 variant.
   *  Kept for backward compatibility; new code should use x402SignChallenge. */
  x402TransferChallenge: () => Promise<{ challengeId: string; refId: string; priceUsdc: string; recipient: string }>;
  /** Read the wallet's current Gateway Balance (USDC custodied by Circle's
   *  GatewayWallet contract for the user's address). */
  getGatewayBalance: () => Promise<bigint>;
  /** Two-step deposit: USDC.approve(GatewayWallet) then GatewayWallet.deposit.
   *  Both challenges fire Circle sign-message modals in sequence. Returns
   *  the on-chain tx hashes for both. */
  depositToGateway: (
    amountUsdc: string,
    opts?: {
      approveLocalizations?: ChallengeLocalizations;
      depositLocalizations?: ChallengeLocalizations;
    },
  ) => Promise<{ approveTxHash: string | null; depositTxHash: string | null }>;
  /** Creates a Circle signTypedData challenge for the EIP-3009
   *  TransferWithAuthorization that Circle Gateway's facilitator expects.
   *  The caller runs the challenge (user signs in PIN modal), then passes
   *  the signature + authorization payload to postJobChallenge so the server
   *  can submit it as X-PAYMENT to the rating API. */
  x402SignChallenge: () => Promise<{
    challengeId: string;
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
    };
    network: string;
    scheme: string;
    x402Version: number;
    asset: string;
    payTo: string;
    amount: string;
  }>;
  /** Returns the contract-execution challenge id for a postGatedJob call. */
  postJobChallenge: (
    form: PostJobInput,
    opts?: {
      x402TransactionId?: string;
      x402RefId?: string;
      x402SignChallengeId?: string;
      x402Signature?: string;
      x402Authorization?: {
        from: string;
        to: string;
        value: string;
        validAfter: string;
        validBefore: string;
        nonce: string;
      };
      x402Network?: string;
      x402Scheme?: string;
      x402Version?: number;
    },
  ) => Promise<{ challengeId: string; draftHash: string }>;
  /** Wraps sdk.execute as a Promise — resolves with txHash on success.
   *  signature surfaces for signTypedData challenges (EIP-3009 x402).
   *  transactionId is Circle's internal id; needed for follow-up polls.
   *  Optional `localizations` override the modal copy (title/subtitle/
   *  description) for this single execution — used to label each step
   *  as "Step N of 3 · …" during the demo. */
  runChallenge: (
    challengeId: string,
    localizations?: ChallengeLocalizations,
  ) => Promise<{
    ok: boolean;
    txHash: string | null;
    transactionId: string | null;
    signature: string | null;
    errorMessage: string | null;
  }>;
  /** Re-fetches wallet info from server. */
  refresh: () => Promise<void>;
}

export interface PostJobInput {
  title: string;
  description: string;
  budgetUsdc: string;
  minTier: 'Gold' | 'Silver' | 'Bronze' | 'Pending';
  minConfidence: 'high' | 'moderate' | 'low' | 'insufficient';
  targetAgentId: string;
  evaluatorAddress?: string;
  deadline?: string;
  /** Opt-in Caliber bond — when true, /jobs/[id] renders the bond panel. */
  bondRequired?: boolean;
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
  // Per Circle Web SDK docs (developers.circle.com/wallets/user-controlled/
  // web-sdk-ui-customizations): override modal copy for the next execute().
  // Same shape applied to both contractInteraction (modals #1+#3) and
  // signatureRequest (modal #2) so the same call works for either path.
  setLocalizations: (localizations: {
    contractInteraction?: { title?: string; subtitle?: string };
    signatureRequest?: { title?: string; subtitle?: string; description?: string };
    transactionRequest?: { title?: string; subtitle?: string };
  }) => void;
};

/**
 * Per-step copy for the Circle PW modal. Applied via sdk.setLocalizations()
 * right before sdk.execute(). Use for the demo to label modals as
 * "Step N of 3" with plain-English explainers.
 */
export interface ChallengeLocalizations {
  title?: string;
  subtitle?: string;
  /** Only honored for signatureRequest modals (modal #2 — x402 sign). */
  description?: string;
}

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
        const email = r.oAuthInfo?.socialUserInfo?.email ?? null;
        await hydrateFromUserToken(r.userToken, r.encryptionKey, email);
        log(`hydrate ok · session set`);
        if (typeof window !== 'undefined' && window.location.hash) {
          history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        // Persist the session (cookie + localStorage) so subsequent page
        // loads skip the sign-in modal. userToken validity from Circle is
        // ~1h; match that with cookie TTL so we never present a stale
        // token. Hydrate-on-mount handles expiry.
        saveSessionItem(SESSION_KEY_USER_TOKEN, r.userToken);
        saveSessionItem(SESSION_KEY_ENCRYPTION_KEY, r.encryptionKey);
        if (email) saveSessionItem(SESSION_KEY_EMAIL, email);
        log(
          `session persisted · cookies+localStorage · userToken=${r.userToken.slice(0, 8)}…`,
        );
        // Clean up cookies that were only needed for the round-trip
        deleteCookie('caliber_circle_deviceToken');
        deleteCookie('caliber_circle_deviceEncryptionKey');
        // Restore the page the user signed in from. Google forces redirect
        // back to origin-only (a single whitelisted URI), so we stashed the
        // path in localStorage before performLogin. Navigation is safe
        // because the session is already persisted to cookies — the new
        // page will rehydrate without another Google round-trip.
        if (typeof window !== 'undefined') {
          const returnPath = window.localStorage.getItem('caliber_post_login_return');
          window.localStorage.removeItem('caliber_post_login_return');
          if (returnPath && returnPath !== window.location.pathname + window.location.search) {
            window.location.replace(returnPath);
            return;
          }
        }
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
                typeof window !== 'undefined' ? window.location.origin : '',
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
        } else {
          // Not a post-redirect mount — try to restore a persisted session so
          // the user doesn't see "Sign in" again on every visit. If the
          // userToken expired Circle-side, hydrate will throw and we wipe
          // the cookies; user lands on the sign-in state as before.
          const savedUserToken = loadSessionItem(SESSION_KEY_USER_TOKEN);
          const savedEncryptionKey = loadSessionItem(SESSION_KEY_ENCRYPTION_KEY);
          const savedEmail = loadSessionItem(SESSION_KEY_EMAIL) || null;
          log(
            `restore probe · userToken=${
              savedUserToken ? savedUserToken.slice(0, 8) + '…' : 'missing'
            } · encryptionKey=${savedEncryptionKey ? 'present' : 'missing'}`,
          );
          if (savedUserToken && savedEncryptionKey) {
            try {
              await hydrateFromUserToken(savedUserToken, savedEncryptionKey, savedEmail);
              log(`session restored from persisted storage`);
            } catch (e) {
              // Don't clear automatically — could be a transient server
              // hiccup. User can signOut to clear, or storage will lapse
              // on its own at TTL. Loud log so we can debug.
              log(`restore failed (${e instanceof Error ? e.message : 'unknown'}) · keeping storage`);
            }
          }
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

      // Use origin-only so only ONE redirect URI needs whitelisting in the
      // Google Cloud Console (origin + pathname requires a separate entry per
      // page the user can sign in from). Save the originating path so we can
      // restore it after Google redirects back.
      const redirectUri = window.location.origin;
      const returnPath = window.location.pathname + window.location.search;
      if (returnPath && returnPath !== '/') {
        window.localStorage.setItem('caliber_post_login_return', returnPath);
      } else {
        window.localStorage.removeItem('caliber_post_login_return');
      }
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
    clearSessionItem(SESSION_KEY_USER_TOKEN);
    clearSessionItem(SESSION_KEY_ENCRYPTION_KEY);
    clearSessionItem(SESSION_KEY_EMAIL);
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

  const x402SignChallenge = useCallback(async () => {
    if (!session?.wallet) throw new Error('wallet not ready');
    const res = await fetch('/api/circle/uc/x402-sign-challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userToken: session.userToken,
        walletId: session.wallet.id,
        walletAddress: session.wallet.address,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message ?? `x402-sign-challenge ${res.status}`);
    }
    return (await res.json()) as Awaited<ReturnType<CircleAuthState['x402SignChallenge']>>;
  }, [session]);

  const getGatewayBalance = useCallback(async () => {
    if (!session?.wallet) throw new Error('wallet not ready');
    const res = await fetch(
      `/api/circle/uc/gateway-balance?address=${session.wallet.address.toLowerCase()}`,
    );
    if (!res.ok) throw new Error(`gateway-balance ${res.status}`);
    const data = (await res.json()) as { gatewayBalance: string };
    return BigInt(data.gatewayBalance);
  }, [session]);

  const depositToGateway = useCallback(
    async (
      amountUsdc: string,
      opts?: {
        approveLocalizations?: ChallengeLocalizations;
        depositLocalizations?: ChallengeLocalizations;
      },
    ) => {
      if (!session?.wallet) throw new Error('wallet not ready');
      const sdk = sdkRef.current;
      if (!sdk) throw new Error('SDK not ready');

      // Step 1: USDC.approve(GatewayWallet, amount)
      const approveRes = await fetch('/api/circle/uc/deposit-approve-challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userToken: session.userToken,
          walletId: session.wallet.id,
          amountUsdc,
        }),
      });
      if (!approveRes.ok) {
        const body = await approveRes.json().catch(() => ({}));
        throw new Error(body.message ?? `deposit-approve-challenge ${approveRes.status}`);
      }
      const { challengeId: approveChallengeId } = (await approveRes.json()) as {
        challengeId: string;
      };
      log(`depositToGateway · approve challenge ${approveChallengeId.slice(0, 8)}…`);
      // User signs in Circle modal
      const approveResult = await runChallenge(approveChallengeId, opts?.approveLocalizations);
      if (approveResult.errorMessage) {
        throw new Error(`approve sign: ${approveResult.errorMessage}`);
      }

      // Step 2: GatewayWallet.deposit(USDC, amount)
      const depositRes = await fetch('/api/circle/uc/deposit-challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userToken: session.userToken,
          walletId: session.wallet.id,
          amountUsdc,
        }),
      });
      if (!depositRes.ok) {
        const body = await depositRes.json().catch(() => ({}));
        throw new Error(body.message ?? `deposit-challenge ${depositRes.status}`);
      }
      const { challengeId: depositChallengeId } = (await depositRes.json()) as {
        challengeId: string;
      };
      log(`depositToGateway · deposit challenge ${depositChallengeId.slice(0, 8)}…`);
      const depositResult = await runChallenge(depositChallengeId, opts?.depositLocalizations);
      if (depositResult.errorMessage) {
        throw new Error(`deposit sign: ${depositResult.errorMessage}`);
      }

      return {
        approveTxHash: approveResult.txHash,
        depositTxHash: depositResult.txHash,
      };
    },
    [session, log],
    // eslint-disable-next-line react-hooks/exhaustive-deps
  );

  const x402TransferChallenge = useCallback(async () => {
    if (!session?.wallet) throw new Error('wallet not ready');
    const res = await fetch('/api/circle/uc/x402-transfer-challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userToken: session.userToken,
        walletId: session.wallet.id,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message ?? `x402-transfer-challenge ${res.status}`);
    }
    return (await res.json()) as {
      challengeId: string;
      refId: string;
      priceUsdc: string;
      recipient: string;
    };
  }, [session]);

  const postJobChallenge = useCallback(
    async (
      form: PostJobInput,
      opts?: {
        x402TransactionId?: string;
        x402RefId?: string;
        x402SignChallengeId?: string;
        x402Signature?: string;
        x402Authorization?: {
          from: string;
          to: string;
          value: string;
          validAfter: string;
          validBefore: string;
          nonce: string;
        };
        x402Network?: string;
        x402Scheme?: string;
        x402Version?: number;
      },
    ) => {
      if (!session?.wallet) throw new Error('wallet not ready');
      const res = await fetch('/api/circle/uc/post-job-challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userToken: session.userToken,
          walletId: session.wallet.id,
          posterAddress: session.wallet.address,
          ...form,
          x402TransactionId: opts?.x402TransactionId,
          x402RefId: opts?.x402RefId,
          x402SignChallengeId: opts?.x402SignChallengeId,
          x402Signature: opts?.x402Signature,
          x402Authorization: opts?.x402Authorization,
          x402Network: opts?.x402Network,
          x402Scheme: opts?.x402Scheme,
          x402Version: opts?.x402Version,
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
    (
      challengeId: string,
      localizations?: ChallengeLocalizations,
    ): Promise<{
      ok: boolean;
      txHash: string | null;
      transactionId: string | null;
      signature: string | null;
      errorMessage: string | null;
    }> => {
      return new Promise((resolve) => {
        if (!sdkRef.current) {
          resolve({
            ok: false,
            txHash: null,
            transactionId: null,
            signature: null,
            errorMessage: 'SDK not initialised',
          });
          return;
        }
        // Apply per-step modal copy. setLocalizations is stateful on the SDK
        // instance, so we set both signatureRequest and contractInteraction
        // with the same {title, subtitle} — whichever modal opens picks up
        // the right one. The description field is signatureRequest-only.
        if (localizations && sdkRef.current.setLocalizations) {
          try {
            sdkRef.current.setLocalizations({
              contractInteraction: {
                title: localizations.title,
                subtitle: localizations.subtitle,
              },
              signatureRequest: {
                title: localizations.title,
                subtitle: localizations.subtitle,
                description: localizations.description,
              },
            });
          } catch {
            // Localization is best-effort — never block the actual execute.
          }
        }
        sdkRef.current.execute(challengeId, (err, result) => {
          if (err) {
            resolve({
              ok: false,
              txHash: null,
              transactionId: null,
              signature: null,
              errorMessage: err.message ?? 'challenge failed',
            });
            return;
          }
          const r = result as
            | {
                txHash?: string | null;
                transactionHash?: string | null;
                id?: string | null;
                transactionId?: string | null;
                signature?: string | null;
                data?: { id?: string | null; transactionId?: string | null; signature?: string | null };
              }
            | undefined;
          const txHash = r?.txHash ?? r?.transactionHash ?? null;
          const transactionId =
            r?.transactionId ?? r?.id ?? r?.data?.transactionId ?? r?.data?.id ?? null;
          const signature = r?.signature ?? r?.data?.signature ?? null;
          resolve({ ok: true, txHash, transactionId, signature, errorMessage: null });
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
      x402TransferChallenge,
      x402SignChallenge,
      getGatewayBalance,
      depositToGateway,
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
      x402TransferChallenge,
      x402SignChallenge,
      getGatewayBalance,
      depositToGateway,
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
