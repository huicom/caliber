import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

export const metadata = {
  title: 'Integrate Caliber — Trust layer for Arc agents',
  description:
    'Two ways to consume Caliber ratings on Arc: HTTP API (any language) or on-chain RatingVerifier (any Solidity contract). SDK in beta — Q3 2026.',
};

export default function IntegratePage() {
  return (
    <main className="mx-auto max-w-[1200px] px-6 md:px-12 pt-12 md:pt-16 pb-24">
      {/* === Editorial header ============================================ */}
      <header className="mb-12 max-w-2xl">
        <p className="font-mono text-[11px] tracking-[0.18em] uppercase text-fg-dim mb-5">
          <span className="rule-accent" />
          for builders
        </p>
        <h1
          className="h-display text-fg"
          style={{ fontSize: 'clamp(2rem, 4.5vw, 3.4rem)' }}
        >
          Integrate the
          <br />
          <span className="text-accent">Caliber rating gate.</span>
        </h1>
        <p className="mt-6 text-fg-mute text-lg leading-relaxed">
          Two surfaces, same methodology. Pick whichever fits your stack — HTTP
          from any language, or on-chain from any Solidity contract.
        </p>
      </header>

      {/* === Two-column code samples ===================================== */}
      <div className="grid gap-8 lg:grid-cols-2">
        {/* HTTP API */}
        <section className="border border-border rounded-xl p-6 bg-bg-elev">
          <p className="font-mono text-[11px] tracking-[0.18em] uppercase text-fg-dim mb-3">
            {'{'}http_api{'}'}
          </p>
          <h2 className="text-xl font-semibold mb-3 text-fg">From any language</h2>
          <p className="text-fg-mute text-sm mb-4 leading-relaxed">
            Read a rating for any Arc-native ERC-8004 agent. Works from Python,
            TypeScript, Go, curl — any HTTP client.
          </p>
          <pre className="bg-bg p-4 rounded-lg border border-border text-xs overflow-x-auto">
            <code>{`curl https://caliber-api.poko.blue/v1/agents/arc/1/rating

# Returns:
# { "rated": true,
#   "rating": "Caliber-AAA",
#   "ppd_30d": 0.0018,
#   "confidence": "low",
#   "methodology_version": "1.0.0",
#   ... }`}</code>
          </pre>
        </section>

        {/* Solidity */}
        <section className="border border-border rounded-xl p-6 bg-bg-elev">
          <p className="font-mono text-[11px] tracking-[0.18em] uppercase text-fg-dim mb-3">
            {'{'}on_chain{'}'}
          </p>
          <h2 className="text-xl font-semibold mb-3 text-fg">
            From any Solidity contract
          </h2>
          <p className="text-fg-mute text-sm mb-4 leading-relaxed">
            Request a signed attestation, pass it to the on-chain verifier. Your
            contract reverts if the agent doesn&apos;t meet your threshold.
          </p>
          <pre className="bg-bg p-4 rounded-lg border border-border text-xs overflow-x-auto">
            <code>{`IRatingVerifier verifier = IRatingVerifier(
  0x32C554edA5CDD2eb94F242ebf3f38820d3C53E29
);

verifier.requireMinRating(
  att,            // EIP-712 RatingAttestation
  signature,      // signed by Caliber
  3,              // max tier allowed (Caliber-BBB)
  1               // min confidence (Medium)
);
// reverts if agent doesn't qualify`}</code>
          </pre>
        </section>
      </div>

      {/* === Caliber as collateral ====================================== */}
      <section className="mt-12 border-t border-border pt-12">
        <p className="font-mono text-[11px] tracking-[0.18em] uppercase text-fg-dim mb-5">
          <span className="rule-accent" />
          new · wave 2
        </p>
        <h2 className="text-2xl font-semibold mb-4 text-fg">
          Caliber as collateral — credit-priced bonds
        </h2>
        <p className="text-fg-mute leading-relaxed max-w-3xl mb-6">
          A Caliber rating prices an agent&apos;s skin in the game. The{' '}
          <code className="text-accent">CaliberEscrow</code> contract reads PD
          and LGD straight off the signed attestation and locks the agent&apos;s
          USDC bond proportional to risk. The same rating that gates a job also
          determines how much capital the agent has to back it.
        </p>

        <div className="grid gap-6 lg:grid-cols-2 mb-6">
          <div className="border border-border rounded-xl p-5 bg-bg-elev">
            <p className="font-mono text-[11px] tracking-[0.18em] uppercase text-fg-dim mb-3">
              {'{'}formula{'}'}
            </p>
            <pre className="bg-bg p-3 rounded-lg border border-border text-xs">
              <code>required_bond = budget × PD × LGD</code>
            </pre>
            <p className="text-fg-mute text-sm mt-3 leading-relaxed">
              PD = probability of performance default (30-day).{' '}
              LGD = loss given failure, segment-specific (§5.3 of the
              methodology). Both signed in the EIP-712 attestation.
            </p>
          </div>

          <div className="border border-border rounded-xl p-5 bg-bg-elev">
            <p className="font-mono text-[11px] tracking-[0.18em] uppercase text-fg-dim mb-3">
              {'{'}example_1000_usdc{'}'}
            </p>
            <table className="w-full text-xs font-mono">
              <thead className="text-fg-dim">
                <tr>
                  <th className="text-left pb-2">tier</th>
                  <th className="text-left pb-2">pd</th>
                  <th className="text-left pb-2">lgd</th>
                  <th className="text-right pb-2">bond</th>
                </tr>
              </thead>
              <tbody className="text-fg">
                <tr className="border-t border-border">
                  <td className="py-1">Caliber-AAA</td>
                  <td className="py-1">0.4%</td>
                  <td className="py-1">15%</td>
                  <td className="py-1 text-right">0.6 USDC</td>
                </tr>
                <tr className="border-t border-border">
                  <td className="py-1">Caliber-BBB</td>
                  <td className="py-1">4%</td>
                  <td className="py-1">30%</td>
                  <td className="py-1 text-right">12 USDC</td>
                </tr>
                <tr className="border-t border-border">
                  <td className="py-1">Caliber-CCC</td>
                  <td className="py-1">30%</td>
                  <td className="py-1">50%</td>
                  <td className="py-1 text-right">150 USDC</td>
                </tr>
                <tr className="border-t border-border">
                  <td className="py-1 text-[var(--color-signal-down)]">Caliber-D</td>
                  <td className="py-1" colSpan={3}>
                    <span className="text-[var(--color-signal-down)]">blocked at the gate</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="text-fg-mute text-xs mt-3 leading-relaxed">
              Higher trust = lower lockup. Capital-efficient by construction.
            </p>
          </div>
        </div>

        <div className="border border-border rounded-xl p-5 bg-bg-elev">
          <p className="font-mono text-[11px] tracking-[0.18em] uppercase text-fg-dim mb-3">
            {'{'}lifecycle{'}'}
          </p>
          <ol className="space-y-2 text-sm text-fg-mute leading-relaxed">
            <li>
              <span className="font-mono text-accent">postBond(jobId, att, sig)</span> — agent
              calls with their own signed attestation. Contract verifies, computes bond, pulls
              USDC. The agent must be the on-chain job&apos;s provider.
            </li>
            <li>
              <span className="font-mono text-accent">release(jobId)</span> — anyone can call.
              Contract reads ERC-8183 status; if Completed, bond returns to the agent.
            </li>
            <li>
              <span className="font-mono text-accent">slash(jobId)</span> — anyone can call. If
              the job is Rejected or Expired, bond goes to the original client (poster).
            </li>
          </ol>
          <pre className="bg-bg p-3 rounded-lg border border-border text-xs mt-4 overflow-x-auto">
            <code>{`CaliberEscrow at 0x0193CB604BC0B4B8853EA45Dfdcd062aa1dc3DF6
  (Arc Testnet, chain 5042002)

uint256 bond = escrow.requiredBond(budget, pdBps, lgdBps);
usdc.approve(address(escrow), bond);
escrow.postBond(jobId, att, signature);`}</code>
          </pre>
        </div>
      </section>

      {/* === SDK callout ================================================= */}
      <section className="mt-12 border-t border-border pt-12">
        <h2 className="text-2xl font-semibold mb-4 text-fg">
          SDK — beta soon
        </h2>
        <p className="text-fg-mute leading-relaxed max-w-2xl">
          <code className="text-accent">@caliber/sdk</code> wraps both surfaces with
          ergonomic TypeScript types and one-call helpers. Coming in Phase 2 of the{' '}
          <a
            href="https://github.com/huicom/arc-agents-explorer"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline inline-flex items-center gap-1"
          >
            roadmap <ArrowUpRight className="inline w-3.5 h-3.5" />
          </a>
          . If you want early access, open a GitHub issue or contact PokoBlue
          (@PokoBlue99) on X.
        </p>
      </section>

      {/* === How it works (linear) ======================================= */}
      <section className="mt-12 border-t border-border pt-12">
        <h2 className="text-2xl font-semibold mb-6 text-fg">How it works</h2>
        <ol className="space-y-4 text-fg-mute leading-relaxed max-w-3xl">
          <li className="flex gap-4">
            <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-accent shrink-0 pt-1 w-12">
              step 1
            </span>
            <span>
              <strong className="text-fg">Read the methodology.</strong>{' '}
              <Link href="/methodology" className="text-accent hover:underline">
                /methodology
              </Link>{' '}
              — published v1.0, open for community review. Defines what
              constitutes a performance default and how PPD / LGD / EAD compose
              into a tier.
            </span>
          </li>
          <li className="flex gap-4">
            <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-accent shrink-0 pt-1 w-12">
              step 2
            </span>
            <span>
              <strong className="text-fg">Query the rating.</strong> HTTP or
              on-chain. Every response carries the{' '}
              <code className="text-accent">methodology_version</code> that
              produced it.
            </span>
          </li>
          <li className="flex gap-4">
            <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-accent shrink-0 pt-1 w-12">
              step 3
            </span>
            <span>
              <strong className="text-fg">Gate your flow.</strong> Refuse to
              fund escrow / accept jobs / pay invoices below your tier
              threshold. Your contract or runtime reverts cleanly with a known
              reason.
            </span>
          </li>
          <li className="flex gap-4">
            <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-accent shrink-0 pt-1 w-12">
              step 4
            </span>
            <span>
              <strong className="text-fg">
                The agent improves or gets filtered out.
              </strong>{' '}
              Their incentive is to climb the tiers. Their on-chain history
              feeds back into the next rating.
            </span>
          </li>
        </ol>
      </section>

      {/* === Demo callout ================================================ */}
      <section className="mt-12 border-t border-border pt-12">
        <h2 className="text-2xl font-semibold mb-4 text-fg">
          See it working end-to-end
        </h2>
        <p className="text-fg-mute leading-relaxed max-w-2xl mb-4">
          The{' '}
          <Link href="/jobs/new" className="text-accent hover:underline">
            Demo Marketplace
          </Link>{' '}
          is the rating gate working in production: post a job, the gateway
          checks the agent&apos;s Caliber rating against your threshold,
          escrows USDC on Arc Testnet, releases on evaluator approval. Try it
          to see exactly what the gate refuses and accepts.
        </p>
        <Link
          href="/jobs/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors"
        >
          Try the demo flow <ArrowUpRight className="w-4 h-4" />
        </Link>
      </section>
    </main>
  );
}
