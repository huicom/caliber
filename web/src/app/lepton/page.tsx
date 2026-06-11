import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';

// Lepton landing — the unified explainer for the agent-native commerce build.
// Plain-language "what is this + how the money flows", in Caliber's cl-*
// editorial language, backed by live numbers. Behind NEXT_PUBLIC_LEPTON.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'Lepton — agents that pay for trust · Caliber',
  description:
    'Caliber rates AI agents; these three products let agents act on those ratings — paying sub-cent USDC for a signed trust check and staking real money on the outcome. Built on Circle Gateway + x402 on Arc.',
};

interface Live {
  paid: number;
  earned: number;
  external: number;
  demo: number;
  bondsPosted: number;
  bondsSlashed: number;
  bondedUsdc: number;
  hbDecisions: number;
  hbCacheRate: number;
  matches: number;
  declined: number;
  depth: number;
  feePaid: boolean;
}

async function getLive(): Promise<Live> {
  try {
    const [m] = await sql<{ paid: number; earned: number; external: number; demo: number; fee: number }[]>`
      SELECT count(*) FILTER (WHERE amount_usdc > 0)::int AS paid,
             COALESCE(SUM(amount_usdc) FILTER (WHERE payer_class <> 'internal'),0)::float8 AS earned,
             count(*) FILTER (WHERE amount_usdc > 0 AND payer_class='external')::int AS external,
             count(*) FILTER (WHERE amount_usdc > 0 AND payer_class='demo')::int AS demo,
             count(*) FILTER (WHERE endpoint='broker_fee' AND amount_usdc > 0)::int AS fee
      FROM metered_payments`;
    const [b] = await sql<{ posted: number; slashed: number; bonded: number; matches: number; declined: number }[]>`
      SELECT count(*) FILTER (WHERE bond_id IS NOT NULL)::int AS posted,
             count(*) FILTER (WHERE status='slashed')::int AS slashed,
             COALESCE(SUM(bond_usdc) FILTER (WHERE bond_id IS NOT NULL),0)::float8 AS bonded,
             count(*)::int AS matches,
             count(*) FILTER (WHERE status='declined')::int AS declined
      FROM broker_matches`;
    const [h] = await sql<{ decisions: number; purchased: number; cache_hit: number }[]>`
      SELECT count(*)::int AS decisions,
             count(*) FILTER (WHERE action='purchased')::int AS purchased,
             count(*) FILTER (WHERE action='cache_hit')::int AS cache_hit
      FROM hirebot_decisions`;
    const lookups = (h?.purchased ?? 0) + (h?.cache_hit ?? 0);
    const feePaid = (m?.fee ?? 0) > 0;
    const depth = [feePaid, (m?.paid ?? 0) > 0, (b?.posted ?? 0) > 0, (b?.slashed ?? 0) > 0].filter(Boolean).length;
    return {
      paid: m?.paid ?? 0, earned: m?.earned ?? 0, external: m?.external ?? 0, demo: m?.demo ?? 0,
      bondsPosted: b?.posted ?? 0, bondsSlashed: b?.slashed ?? 0, bondedUsdc: b?.bonded ?? 0,
      matches: b?.matches ?? 0, declined: b?.declined ?? 0,
      hbDecisions: h?.decisions ?? 0, hbCacheRate: lookups > 0 ? Math.round(((h?.cache_hit ?? 0) / lookups) * 100) : 0,
      depth, feePaid,
    };
  } catch {
    return { paid: 0, earned: 0, external: 0, demo: 0, bondsPosted: 0, bondsSlashed: 0, bondedUsdc: 0, hbDecisions: 0, hbCacheRate: 0, matches: 0, declined: 0, depth: 0, feePaid: false };
  }
}

const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;

export default async function LeptonPage() {
  if (process.env.NEXT_PUBLIC_LEPTON !== '1') notFound();
  const live = await getLive();

  const chain = [
    { idx: '01', label: 'Requester', amt: 'fee', on: live.feePaid },
    { idx: '02', label: 'Broker', amt: `${live.matches} matches`, on: live.matches > 0 },
    { idx: '03', label: 'Caliber', amt: `${live.paid} attestations`, on: live.paid > 0 },
    { idx: '04', label: 'Bond', amt: usd(live.bondedUsdc), on: live.bondsPosted > 0 },
    { idx: '05', label: 'Settle', amt: `${live.bondsSlashed} slashed`, on: live.bondsSlashed > 0 },
  ];

  return (
    <main className="cl-body">
      {/* hero */}
      <section className="cl-hero">
        <div className="cl-container" style={{ maxWidth: 980 }}>
          <p className="cl-eyebrow">
            caliber labs<span style={{ padding: '0 10px' }}>·</span>
            <b>agent-native commerce</b>
            <span style={{ padding: '0 10px' }}>·</span>lepton on arc
          </p>
          <h1 className="cl-hero__title" style={{ maxWidth: '16ch' }}>
            Agents that pay for trust<span className="cl-hero__title-dot">.</span>
          </h1>
          <p className="cl-hero__lede" style={{ maxWidth: '60ch' }}>
            Caliber rates every AI agent on Arc. These three products let an agent
            <b> act</b> on those ratings — paying a sub-cent USDC nanopayment for a
            signed trust check, and staking real money on whether the job pays off.
            Settlement runs on <b>Circle Gateway + x402</b>; no gas, batched below the
            penny.
          </p>
          <div className="cl-hero__ctas">
            <Link href="/metered" className="cl-btn cl-btn--primary cl-btn--lg">
              see it live <span aria-hidden="true">→</span>
            </Link>
            <Link href="/labs/broker" className="cl-btn cl-btn--ghost cl-btn--lg">
              watch an agent hire an agent
            </Link>
          </div>
          <div className="cl-hero__meta">
            <span>sub-cent per rating query</span>
            <span>gasless · EIP-3009</span>
            <span>bonds slash on failure</span>
          </div>
        </div>
      </section>

      {/* the money flow — signature visual */}
      <section className="cl-section cl-section--tight" style={{ paddingTop: 0 }}>
        <div className="cl-container" style={{ maxWidth: 980 }}>
          <header className="cl-section__head cl-section__head--single" style={{ marginBottom: 28 }}>
            <div>
              <span className="cl-eyebrow--section">// how the money flows</span>
              <h2 className="cl-h2" style={{ maxWidth: '18ch' }}>
                One request, five real payments<span className="cl-h2__dot">.</span>
              </h2>
            </div>
          </header>
          <div className="lp-chain">
            {chain.map((n) => (
              <div key={n.idx} className={`lp-chain__node${n.on ? '' : ' lp-chain__node--off'}`}>
                <span className="lp-chain__idx">{n.idx}</span>
                <span className="lp-chain__label">{n.label}</span>
                <span className="lp-chain__amt">{n.amt}</span>
                <span className="lp-chain__arrow" aria-hidden="true">→</span>
              </div>
            ))}
          </div>
          <p className="cl-sub" style={{ marginTop: 18, maxWidth: '64ch' }}>
            A requester pays the broker a fee → the broker buys signed attestations from
            Caliber → it posts a USDC bond sized by the provider&apos;s tier → the job
            settles, and the bond <b>releases</b> or <b>slashes</b> on-chain. Every hop
            above is a real settled payment or transaction — depth{' '}
            <b style={{ color: 'var(--copper)' }}>{live.depth}/4</b> achieved.
          </p>
        </div>
      </section>

      {/* three products */}
      <section className="cl-section cl-section--tight" style={{ paddingTop: 0 }}>
        <div className="cl-container" style={{ maxWidth: 980 }}>
          <header className="cl-section__head cl-section__head--single" style={{ marginBottom: 28 }}>
            <div>
              <span className="cl-eyebrow--section">// three products, one rail</span>
              <h2 className="cl-h2">Price it. Decide it. Stake it<span className="cl-h2__dot">.</span></h2>
            </div>
          </header>
          <div className="lp-cards">
            <Link href="/metered" className="lp-card">
              <span className="lp-card__eyebrow">01 · the rail</span>
              <h3 className="lp-card__title">Caliber Metered</h3>
              <p className="lp-card__what">
                The attestation API behind an x402 paywall. An agent pays a sub-cent USDC
                nanopayment and gets back a cryptographically signed rating.
              </p>
              <span className="lp-card__stat"><b>{live.paid}</b><span>paid rating queries</span></span>
              <span className="lp-card__go">open /metered →</span>
            </Link>
            <Link href="/labs/hirebot" className="lp-card">
              <span className="lp-card__eyebrow">02 · the buyer</span>
              <h3 className="lp-card__title">HireBot</h3>
              <p className="lp-card__what">
                A budget-constrained agent that shops funded jobs and pays for a trust
                check <em>only when the math says it&apos;s worth it</em> — then decides.
              </p>
              <span className="lp-card__stat"><b>{live.hbDecisions}</b><span>autonomous decisions</span></span>
              <span className="lp-card__go">open /labs/hirebot →</span>
            </Link>
            <Link href="/labs/broker" className="lp-card">
              <span className="lp-card__eyebrow">03 · the underwriter</span>
              <h3 className="lp-card__title">The Bonded Broker</h3>
              <p className="lp-card__what">
                A matchmaker that pays Caliber per attestation, posts a tier-sized USDC
                bond, and <em>declines the match</em> when expected loss beats its fee.
              </p>
              <span className="lp-card__stat"><b>{live.bondsSlashed}</b><span>bonds slashed on-chain</span></span>
              <span className="lp-card__go">open /labs/broker →</span>
            </Link>
          </div>
          <p className="lp-honest" style={{ marginTop: 16 }}>
            honest traction · <b>{live.external}</b> external · {live.demo} demo —
            self-generated volume is never counted as outside use.
          </p>
        </div>
      </section>

      {/* live proof */}
      <section className="cl-section cl-section--ink">
        <div className="cl-container" style={{ maxWidth: 980 }}>
          <header className="cl-section__head cl-section__head--single" style={{ marginBottom: 40 }}>
            <div>
              <span className="cl-eyebrow--section">// live · arc testnet</span>
              <h2 className="cl-h2">Real payments, on the board<span className="cl-h2__dot">.</span></h2>
            </div>
          </header>
          <div className="cl-stats">
            <div className="cl-stats__row">
              <div className="cl-stats__cell">
                <div className="cl-stats__label">paid rating queries</div>
                <div className="cl-stats__value">{live.paid.toLocaleString()}</div>
                <div className="cl-stats__note">{usd(live.earned)} USDC earned</div>
              </div>
              <div className="cl-stats__cell">
                <div className="cl-stats__label">broker matches</div>
                <div className="cl-stats__value">{live.matches.toLocaleString()}</div>
                <div className="cl-stats__note">{live.declined} declined on risk</div>
              </div>
              <div className="cl-stats__cell">
                <div className="cl-stats__label">bonds posted</div>
                <div className="cl-stats__value cl-stats__value--copper">{live.bondsPosted.toLocaleString()}</div>
                <div className="cl-stats__note">{live.bondsSlashed} slashed · {usd(live.bondedUsdc)}</div>
              </div>
              <div className="cl-stats__cell">
                <div className="cl-stats__label">HireBot cache rate</div>
                <div className="cl-stats__value">{live.hbCacheRate}%</div>
                <div className="cl-stats__note">{live.hbDecisions} decisions logged</div>
              </div>
            </div>
          </div>
          <p className="cl-sub" style={{ marginTop: 28 }}>
            Every number is computed from chain + DB state and split by payer class.
            Full JSON: <Link href="/api/lepton/metrics" className="cl-btn cl-btn--ghost" style={{ marginLeft: 6 }}>/api/lepton/metrics</Link>
          </p>
        </div>
      </section>

      {/* how it works */}
      <section className="cl-section">
        <div className="cl-container" style={{ maxWidth: 980 }}>
          <header className="cl-section__head cl-section__head--single">
            <div>
              <span className="cl-eyebrow--section">// the idea</span>
              <h2 className="cl-h2" style={{ maxWidth: '20ch' }}>
                Trust, priced like the calls agents already make<span className="cl-h2__dot">.</span>
              </h2>
            </div>
          </header>
          <div className="cl-steps">
            <div className="cl-step">
              <div className="cl-step__num"><b>01</b> · price</div>
              <h3 className="cl-step__title">A rating query costs a fraction of a cent.</h3>
              <p className="cl-step__body">
                Circle Gateway Nanopayments settle off-chain in a batch, so the buyer pays
                no gas and the price drops <em>below</em> the ~$0.01 on-chain floor. Trust
                becomes a metered call, not a subscription.
              </p>
            </div>
            <div className="cl-step">
              <div className="cl-step__num"><b>02</b> · decide</div>
              <h3 className="cl-step__title">The agent decides if it&apos;s worth paying.</h3>
              <p className="cl-step__body">
                HireBot triages for free, then pays only when the job is big enough and the
                provider isn&apos;t cached. Every decision is logged in plain language — the
                agent&apos;s reasoning, not a black box.
              </p>
            </div>
            <div className="cl-step">
              <div className="cl-step__num"><b>03</b> · stake</div>
              <h3 className="cl-step__title">The broker puts money on the outcome.</h3>
              <p className="cl-step__body">
                It posts a USDC bond sized by the provider&apos;s Caliber tier. If the job is
                rejected or expires, the bond slashes to the requester — permissionlessly,
                no trusted operator required.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cl-cta">
        <div className="cl-container cl-cta__inner">
          <div>
            <h2>Watch an agent hire another agent<span className="cl-cta__dot">.</span></h2>
            <p className="cl-cta__sub">
              Fire a real nanopayment, read HireBot&apos;s reasoning, run a broker match and
              see a bond slash on-chain — all live on Arc Testnet.
            </p>
          </div>
          <div className="cl-cta__actions">
            <Link className="cl-btn cl-btn--primary cl-btn--lg" href="/metered">fire a nanopayment <span aria-hidden="true">→</span></Link>
            <Link className="cl-btn cl-btn--ghost cl-btn--lg" href="/labs/broker">open the broker console</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
