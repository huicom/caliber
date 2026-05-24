'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/* ──────────────────────────────────────────────────────────────────────────
 * "Demo without MetaMask" — powered by Circle Programmable Wallets.
 *
 * A judge with no crypto wallet clicks one button: Caliber spins up a
 * Circle developer-controlled wallet for their session, requests
 * testnet USDC + gas via Circle's faucet, then runs the full Caliber-
 * gated job-post flow (USDC.approve → RatingGateway.postGatedJob)
 * server-side via Circle's contractExecution API. End state matches
 * the wallet-based flow: a job posted on Arc Testnet, indexed at
 * /jobs/[id], visible on Arcscan.
 *
 * Circle env vars (CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET,
 * CIRCLE_DEMO_WALLET_SET_ID) must be set on the server. When unset the
 * server returns 503 and this panel shows the configuration banner.
 * ────────────────────────────────────────────────────────────────────────── */

interface Props {
  /** Form fields read from the parent so we don't duplicate input UI.
   *  evaluatorAddress + deadline are optional — server fills sensible
   *  defaults (wallet self-eval, deadline = +7 days) when omitted. */
  getFormData: () => null | {
    title: string;
    description: string;
    budgetUsdc: string;
    minTier: 'Gold' | 'Silver' | 'Bronze' | 'Pending';
    minConfidence: 'high' | 'moderate' | 'low';
    targetAgentId: string;
    evaluatorAddress?: string;
    deadline?: string;
  };
}

type Step = 'idle' | 'submitting' | 'waiting_approve' | 'waiting_post' | 'success' | 'error';

interface DemoResult {
  walletAddress?: string;
  jobId?: string | null;
  approveTxHash?: string | null;
  postTxHash?: string | null;
}

interface UnfundedInfo {
  walletAddress: string;
  faucetUrl: string;
}

export function CircleDemoPanel({ getFormData }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DemoResult | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [unfunded, setUnfunded] = useState<UnfundedInfo | null>(null);

  async function handleDemo() {
    const form = getFormData();
    if (!form) {
      setError('Fill in the form above first — title, description, budget, agent.');
      setStep('error');
      return;
    }
    // evaluatorAddress is optional: server defaults to the Circle wallet
    // address (self-eval) so judges can demo without supplying one.

    setError(null);
    setResult(null);
    setUnfunded(null);
    setStep('submitting');

    try {
      const res = await fetch('/api/circle/demo-gated-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (res.status === 503) {
        setUnavailable(true);
        setStep('error');
        setError('Demo mode is not configured on this server (missing Circle env vars).');
        return;
      }
      if (res.status === 402) {
        // Wallet needs manual funding via https://faucet.circle.com
        const body = await res.json().catch(() => ({}));
        setUnfunded({
          walletAddress: body.walletAddress ?? '',
          faucetUrl: body.faucetUrl ?? 'https://faucet.circle.com',
        });
        setStep('error');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg =
          body.detail || body.reason || body.message || `demo endpoint returned ${res.status}`;
        setError(msg);
        setStep('error');
        return;
      }

      const data = (await res.json()) as DemoResult & { ok: boolean };
      setResult(data);
      setStep('success');

      if (data.jobId) {
        setTimeout(() => router.push(`/jobs/${data.jobId}`), 2_500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'demo failed');
      setStep('error');
    }
  }

  return (
    <details
      className="border border-[var(--color-copper)]/30 bg-[#FFF7ED] rounded-[2px]"
      open={step !== 'idle'}
    >
      <summary className="cursor-pointer px-5 py-3 flex items-baseline justify-between gap-3 flex-wrap hover:bg-[#FED7AA]/30 transition">
        <div className="space-y-0.5">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-copper)]">
            //circle_programmable_wallets · demo without metamask
          </p>
          <p className="text-sm text-[var(--color-ink)]">
            <strong>Judge mode:</strong> spin up a Caliber demo wallet on Arc Testnet and post a
            gated job in one click. No browser extension needed.
          </p>
        </div>
        <span className="font-mono text-[10px] text-[var(--color-mute)]">click to expand ▾</span>
      </summary>

      <div className="px-5 pb-5 space-y-3 border-t border-[var(--color-copper)]/20">
        <p className="text-xs text-[var(--color-mute)] leading-relaxed">
          Fill the form above (title, agent, budget, evaluator). Then click below — Caliber will
          provision a Circle wallet for your browser session, faucet it with testnet USDC + gas,
          and run <code className="font-mono">USDC.approve</code> +{' '}
          <code className="font-mono">RatingGateway.postGatedJob</code> server-side via Circle&rsquo;s
          contract-execution API. Same on-chain end-state as the wallet flow.
        </p>

        {unavailable && (
          <div className="border-l-2 border-[var(--color-copper)] bg-white px-3 py-2 text-xs">
            <p className="text-[var(--color-ink)]">
              <strong>demo mode unavailable:</strong> the deployed server has no Circle credentials
              configured. See <code className="font-mono">CIRCLE_API_KEY</code>,{' '}
              <code className="font-mono">CIRCLE_ENTITY_SECRET</code>,{' '}
              <code className="font-mono">CIRCLE_DEMO_WALLET_SET_ID</code> in{' '}
              <code className="font-mono">.env.example</code>.
            </p>
          </div>
        )}

        {unfunded && (
          <div className="border-l-2 border-[var(--color-copper)] bg-white px-4 py-3 text-xs space-y-2">
            <p className="font-mono uppercase tracking-[0.05em] text-[var(--color-copper)]">
              ⚠ fund demo wallet first
            </p>
            <p className="text-[var(--color-ink)] leading-relaxed">
              Your Caliber demo wallet has 0 USDC. Arc Testnet uses USDC for gas,
              so the wallet needs at least 1 USDC to run the gated flow.
              The Arc faucet sends 10 USDC per request (2-hour rate limit).
            </p>
            <div className="bg-[var(--color-bg-elev)] border border-[var(--color-hairline)] rounded-[2px] px-2.5 py-2 space-y-1 font-mono">
              <div className="text-[10px] text-[var(--color-mute)] uppercase tracking-[0.05em]">
                copy this address
              </div>
              <div className="text-[var(--color-ink)] break-all select-all">
                {unfunded.walletAddress}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={unfunded.faucetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-3 py-1.5 bg-[var(--color-copper)] text-white rounded-[2px] font-medium hover:opacity-90"
              >
                open arc faucet →
              </a>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(unfunded.walletAddress);
                }}
                className="inline-block px-3 py-1.5 border border-[var(--color-hairline)] bg-white text-[var(--color-ink)] rounded-[2px] font-medium hover:border-[var(--color-ink)]"
              >
                copy address
              </button>
            </div>
            <p className="text-[10px] text-[var(--color-mute)] leading-relaxed">
              Steps: open the faucet · paste the address · click "Send 10 USDC" · wait ~15 sec for confirmation · come back and click "run demo" again.
            </p>
          </div>
        )}

        {error && !unavailable && (
          <div className="border-l-2 border-[var(--color-signal-down)] bg-white px-3 py-2 text-xs text-[var(--color-signal-down)]">
            {error}
          </div>
        )}

        {step === 'success' && result && (
          <div className="border-l-2 border-[var(--color-signal-up)] bg-white px-3 py-2 text-xs space-y-1">
            <p className="text-[var(--color-signal-up)] font-semibold">
              ✓ gated job posted via Circle
            </p>
            {result.walletAddress && (
              <p className="font-mono text-[var(--color-mute)]">
                wallet · {result.walletAddress.slice(0, 10)}…{result.walletAddress.slice(-6)}
              </p>
            )}
            {result.approveTxHash && (
              <p className="font-mono text-[var(--color-mute)]">
                approve ·{' '}
                <a
                  href={`https://testnet.arcscan.app/tx/${result.approveTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--color-copper)] hover:underline"
                >
                  {result.approveTxHash.slice(0, 12)}…
                </a>
              </p>
            )}
            {result.postTxHash && (
              <p className="font-mono text-[var(--color-mute)]">
                postGatedJob ·{' '}
                <a
                  href={`https://testnet.arcscan.app/tx/${result.postTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--color-copper)] hover:underline"
                >
                  {result.postTxHash.slice(0, 12)}…
                </a>
              </p>
            )}
            {result.jobId && (
              <p className="text-[var(--color-ink)]">
                redirecting to <code className="font-mono">/jobs/{result.jobId}</code>…
              </p>
            )}
          </div>
        )}

        {(step === 'submitting' || step === 'waiting_approve' || step === 'waiting_post') && (
          <div className="border-l-2 border-[var(--color-copper)] bg-white px-3 py-2 text-xs text-[var(--color-copper)] font-mono">
            running 2 on-chain transactions via Circle… this takes 30-60 seconds.
          </div>
        )}

        <button
          onClick={handleDemo}
          disabled={step === 'submitting' || step === 'waiting_approve' || step === 'waiting_post'}
          className="w-full py-2.5 px-4 bg-[var(--color-copper)] text-white text-sm font-medium rounded-[2px] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {step === 'idle' || step === 'error' || step === 'success'
            ? 'run demo (creates wallet · faucets USDC · posts job)'
            : 'submitting via circle…'}
        </button>

        <p className="text-[10px] text-[var(--color-mute)] font-mono leading-relaxed">
          chain: ARC-TESTNET · custody: developer-controlled · session: cookie · gas: usdc-native ·
          docs:{' '}
          <a
            href="https://developers.circle.com/wallets/dev-controlled"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--color-copper)] hover:underline"
          >
            developers.circle.com/wallets/dev-controlled
          </a>
        </p>
      </div>
    </details>
  );
}
