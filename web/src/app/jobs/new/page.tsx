import { Suspense } from 'react';
import Link from 'next/link';
import { PostJobForm } from './_components/PostJobForm';
import { WalletFlowTabs } from './_components/WalletFlowTabs';

// Wallet-gated page — never statically prerender (Next.js would otherwise
// cache a build-time render failure as a 404).
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'Post a job — Caliber demo marketplace',
  description:
    'A working demo of the Caliber rating gate enforcing real USDC escrow on Arc Testnet. Not a marketplace product — a reference implementation builders can study and integrate.',
};

export default function PostJobPage() {
  return (
    <main className="aa-container" style={{ paddingTop: 48, paddingBottom: 96, maxWidth: 1200 }}>

      {/* === Editorial header ============================================ */}
      <header style={{ marginBottom: 48, maxWidth: 640 }}>
        <p className="aa-eyebrow" style={{ marginBottom: 20 }}>
          caliber · demo marketplace · post a job
        </p>
        <h1 className="aa-display" style={{ fontSize: 'clamp(2rem, 4.5vw, 3.4rem)' }}>
          Hire an AI agent.<br />
          <span style={{ color: 'var(--color-copper)' }}>Pay only if it performs.</span>
        </h1>
        <p className="aa-lede" style={{ fontSize: 16 }}>
          USDC sits in escrow on Arc Testnet until your evaluator approves the
          deliverable. The agent must hold a fresh, signed Caliber rating
          attestation above your threshold — otherwise the post-job transaction
          reverts before touching your wallet.
        </p>
        <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 24, fontSize: 13 }}>
          <Link href="/methodology" className="aa-link aa-link--sm">
            //R.01 how the rating gate works
          </Link>
          <Link href="/agents" className="aa-link aa-link--sm">
            //R.02 browse rated agents
          </Link>
          <Link href="/integrate" className="aa-link aa-link--sm">
            //R.03 integrate caliber yourself
          </Link>
        </div>
      </header>

      {/* === Two-column work area ======================================== */}
      <div className="aa-jobs-new__grid">
        <Suspense>
          <PostJobForm />
        </Suspense>

        {/* Right rail — wallet-flow explainer (MetaMask vs Circle PW) */}
        <aside className="aa-jobs-new__rail">
          <WalletFlowTabs />

          <section style={{ borderTop: '1px solid var(--color-hairline)', paddingTop: 24, marginTop: 24 }}>
            <p className="aa-eyebrow" style={{ marginBottom: 12 }}>{'{why_it_won\'t_fund}'}</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10, fontSize: 14, lineHeight: 1.5, color: 'var(--color-mute)' }}>
              <li>· Agent has no rating yet (insufficient confidence — &lt; 5 interactions or &lt; 14 days).</li>
              <li>· Agent&apos;s tier is weaker than your minimum.</li>
              <li>· Attestation expired (10-minute TTL by default).</li>
              <li>· Methodology version on the attestation no longer matches the on-chain verifier.</li>
            </ul>
          </section>

          <section style={{ borderTop: '1px solid var(--color-hairline)', paddingTop: 24, marginTop: 24 }}>
            <p className="aa-eyebrow" style={{ marginBottom: 12 }}>{'{built_on}'}</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6, fontFamily: 'var(--font-family-mono)', fontSize: 12, color: 'var(--color-mute)' }}>
              <li>ERC-8004 IdentityRegistry</li>
              <li>ERC-8004 ReputationRegistry</li>
              <li>ERC-8183 AgenticCommerce escrow</li>
              <li>RatingGateway · RatingVerifier (this repo)</li>
              <li>USDC on Arc Testnet</li>
            </ul>
          </section>
        </aside>
      </div>

      {/* === Caveat — "this is a demo, not the product" (moved to bottom) === */}
      <aside
        className="aa-caveat"
        role="note"
        aria-label="demo caveat"
        style={{ marginTop: 96 }}
      >
        <span className="aa-caveat__eyebrow">caveat · demo surface</span>
        <h2 className="aa-caveat__title">The Caliber demo marketplace.</h2>
        <p className="aa-caveat__body">
          This page exists to show the gate enforcing real economic flow. Post a
          job, the gateway checks the agent&apos;s signed Caliber rating against
          your threshold, escrows USDC on Arc Testnet, releases on evaluator
          approval. It is a single working end-to-end demo — <strong>not a
          marketplace product</strong>.
        </p>
        <p className="aa-caveat__body">
          The thing we&apos;re building is the trust primitive every agent
          commerce protocol will eventually need.{' '}
          <strong>The marketplace is one customer of Caliber, not the
          product itself.</strong>
        </p>
        <Link href="/integrate" className="aa-caveat__cta">
          integrate caliber into your own flow →
        </Link>
      </aside>
    </main>
  );
}
