import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';

// A page addressed to the Canteen / Lepton context: it maps Canteen's
// "distribution bootstrap for payments founders" thesis (per-event nanopayments
// below the fee floor, permissionless sidecars reading existing APIs as payment
// surfaces) onto what Caliber actually runs — applied to agent trust. Live,
// honest numbers only. Behind NEXT_PUBLIC_LEPTON.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'Per-event trust, priced below the fee floor · Caliber × Canteen',
  description:
    "Canteen's distribution-bootstrap thesis — batched onchain nanopayments make per-event micropayments viable — running for agent trust on Arc.",
};

async function getLive() {
  try {
    const [m] = await sql<{ paid: number; earned: number; external: number; demo: number }[]>`
      SELECT count(*) FILTER (WHERE amount_usdc > 0)::int AS paid,
             COALESCE(SUM(amount_usdc) FILTER (WHERE payer_class<>'internal'),0)::float8 AS earned,
             count(*) FILTER (WHERE amount_usdc > 0 AND payer_class='external')::int AS external,
             count(*) FILTER (WHERE amount_usdc > 0 AND payer_class='demo')::int AS demo
      FROM metered_payments`;
    const [b] = await sql<{ posted: number; slashed: number }[]>`
      SELECT count(*) FILTER (WHERE bond_id IS NOT NULL)::int AS posted,
             count(*) FILTER (WHERE status='slashed')::int AS slashed FROM broker_matches`;
    const [h] = await sql<{ decisions: number }[]>`SELECT count(*)::int AS decisions FROM hirebot_decisions`;
    return {
      paid: m?.paid ?? 0, earned: m?.earned ?? 0, external: m?.external ?? 0, demo: m?.demo ?? 0,
      posted: b?.posted ?? 0, slashed: b?.slashed ?? 0, decisions: h?.decisions ?? 0,
    };
  } catch {
    return { paid: 0, earned: 0, external: 0, demo: 0, posted: 0, slashed: 0, decisions: 0 };
  }
}

const SNIPPET = `import { Caliber } from '@caliber/sdk';
const caliber = new Caliber();

// Before your agent pays a counterparty, buy a signed trust check.
// One sub-cent USDC nanopayment (x402 · Circle Gateway). No gas, no account.
const verdict = await caliber.attest('arc', providerId, { minTier: 'Silver' });

if (!verdict.signature) return;   // didn't clear the bar — skip the risk
pay(providerId);                  // a Caliber-signed, on-chain-verifiable OK`;

// Hand-drawn schematic of a single per-event trust check settling — ink +
// copper, mono labels, matching the homepage's cl-step diagrams.
function TrustCheckFlow() {
  const mono = 'JetBrains Mono, monospace';
  const W = 150;
  const nodes = [
    { x: 25, n: '01', t: 'AGENT', s: 'needs trust', copper: false },
    { x: 215, n: '02', t: 'x402', s: '402 → sign', copper: false },
    { x: 405, n: '03', t: 'GATEWAY', s: 'batch · N→1 tx', copper: true },
    { x: 595, n: '04', t: 'CALIBER', s: 'signed tier', copper: false },
    { x: 785, n: '05', t: 'DECIDE', s: 'pay ✓ / skip ✗', copper: false },
  ];
  return (
    <svg viewBox="0 0 960 175" style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="How a per-event trust check settles: agent, x402 sign, Circle Gateway batch, Caliber signed attestation, decide">
      {nodes.map((nd, i) => (
        <g key={nd.n}>
          <rect x={nd.x} y={46} width={W} height={60} rx={3} fill="#FBF8F2" stroke={nd.copper ? '#C2410C' : '#0E1116'} strokeWidth={nd.copper ? 1.5 : 1} />
          <text x={nd.x + 7} y={38} fontFamily={mono} fontSize={10} fill="#C2410C">{nd.n}</text>
          <text x={nd.x + W / 2} y={82} fontFamily={mono} fontSize={15} fontWeight={600} fill={nd.copper ? '#C2410C' : '#0E1116'} textAnchor="middle">{nd.t}</text>
          <text x={nd.x + W / 2} y={124} fontFamily={mono} fontSize={10.5} fill="#6B7280" textAnchor="middle">{nd.s}</text>
          {i < nodes.length - 1 ? (
            <g stroke="#C2410C" strokeWidth={1.3}>
              <line x1={nd.x + W + 5} y1={76} x2={nd.x + W + 33} y2={76} />
              <polygon points={`${nd.x + W + 33},72 ${nd.x + W + 40},76 ${nd.x + W + 33},80`} fill="#C2410C" stroke="none" />
            </g>
          ) : null}
        </g>
      ))}
      <text x={480} y={158} fontFamily={mono} fontSize={11} fill="#6B7280" textAnchor="middle">
        one EIP-3009 signature · no gas · settles below the ~$0.01 on-chain floor
      </text>
    </svg>
  );
}

// $0.01 gas floor vs $0.001 toll — the constraint onchain settlement removes.
function FeeFloorBars() {
  const mono = 'JetBrains Mono, monospace';
  return (
    <svg viewBox="0 0 300 195" style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="$0.01 per-transaction gas floor versus $0.001 Caliber toll, ten times under the floor">
      <line x1={16} y1={28} x2={284} y2={28} stroke="#6B7280" strokeWidth={1} strokeDasharray="4 4" />
      <text x={284} y={22} fontFamily={mono} fontSize={9.5} fill="#6B7280" textAnchor="end">~$0.01 fee floor</text>
      <rect x={55} y={28} width={70} height={132} fill="#EFEBE2" stroke="#0E1116" strokeWidth={1} />
      <text x={90} y={20} fontFamily={mono} fontSize={13} fontWeight={600} fill="#0E1116" textAnchor="middle">$0.01</text>
      <text x={90} y={176} fontFamily={mono} fontSize={9.5} fill="#6B7280" textAnchor="middle">per on-chain tx</text>
      <rect x={185} y={147} width={70} height={13} fill="#C2410C" stroke="#C2410C" />
      <text x={220} y={140} fontFamily={mono} fontSize={13} fontWeight={600} fill="#C2410C" textAnchor="middle">$0.001</text>
      <text x={220} y={176} fontFamily={mono} fontSize={9.5} fill="#6B7280" textAnchor="middle">Caliber toll</text>
      <text x={220} y={128} fontFamily={mono} fontSize={10} fontWeight={600} fill="#C2410C" textAnchor="middle">10× under</text>
      <line x1={30} y1={160} x2={270} y2={160} stroke="#0E1116" strokeWidth={1} />
    </svg>
  );
}

// Many sub-cent nanopayments batch into one on-chain settlement.
function BatchedSettlement() {
  const mono = 'JetBrains Mono, monospace';
  const dots = [40, 70, 100, 130, 160];
  return (
    <svg viewBox="0 0 460 200" style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Many sub-cent nanopayments batch into one on-chain settlement transaction">
      <text x={48} y={26} fontFamily={mono} fontSize={9.5} fill="#6B7280" textAnchor="middle">N · $0.001</text>
      {dots.map((y) => (
        <g key={y}>
          <circle cx={48} cy={y} r={5} fill="#C2410C" />
          <line x1={56} y1={y} x2={166} y2={100} stroke="#C2410C" strokeWidth={0.8} opacity={0.45} />
        </g>
      ))}
      <rect x={166} y={64} width={118} height={72} rx={3} fill="#FBF8F2" stroke="#C2410C" strokeWidth={1.5} />
      <text x={225} y={96} fontFamily={mono} fontSize={13} fontWeight={600} fill="#C2410C" textAnchor="middle">GATEWAY</text>
      <text x={225} y={114} fontFamily={mono} fontSize={9.5} fill="#6B7280" textAnchor="middle">batches off-chain</text>
      <line x1={284} y1={100} x2={322} y2={100} stroke="#0E1116" strokeWidth={1.3} />
      <polygon points="322,96 329,100 322,104" fill="#0E1116" />
      <rect x={329} y={74} width={108} height={52} rx={3} fill="#0E1116" />
      <text x={383} y={97} fontFamily={mono} fontSize={12} fontWeight={600} fill="#F4F1EB" textAnchor="middle">1 SETTLE</text>
      <text x={383} y={113} fontFamily={mono} fontSize={9} fill="#C7C3BB" textAnchor="middle">on-chain tx</text>
      <text x={230} y={188} fontFamily={mono} fontSize={10} fill="#6B7280" textAnchor="middle">hundreds of nanopayments → one settlement · gas amortized across all</text>
    </svg>
  );
}

// Bond size scales with the provider's risk tier.
function BondLadder() {
  const mono = 'JetBrains Mono, monospace';
  const rows = [
    { tier: 'Gold', bps: 50, pct: '0.5%', c: '#B8862B' },
    { tier: 'Silver', bps: 150, pct: '1.5%', c: '#7E8690' },
    { tier: 'Bronze', bps: 500, pct: '5%', c: '#8C5A2C' },
    { tier: 'Pending', bps: 1500, pct: '15%', c: '#98948C' },
  ];
  return (
    <svg viewBox="0 0 520 200" style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Bond size scales with risk tier: Gold 0.5%, Silver 1.5%, Bronze 5%, Pending 15% of job value">
      {rows.map((r, i) => {
        const y = 20 + i * 38;
        const w = Math.max(6, (r.bps / 1500) * 330);
        return (
          <g key={r.tier}>
            <text x={10} y={y + 14} fontFamily={mono} fontSize={12} fontWeight={600} fill="#0E1116">{r.tier}</text>
            <rect x={92} y={y} width={w} height={20} fill={r.c} stroke="#0E1116" strokeWidth={0.75} />
            <text x={92 + w + 8} y={y + 14} fontFamily={mono} fontSize={11} fill="#0E1116">{r.pct}</text>
          </g>
        );
      })}
      <text x={10} y={188} fontFamily={mono} fontSize={9.5} fill="#6B7280">bond = tier-priced % of job value · Watch &amp; Dormant refused · cap 50%</text>
    </svg>
  );
}

export default async function CanteenPage() {
  if (process.env.NEXT_PUBLIC_LEPTON !== '1') notFound();
  const live = await getLive();

  return (
    <main className="cl-body">
      {/* hero */}
      <section className="cl-hero">
        <div className="cl-container" style={{ maxWidth: 940 }}>
          <p className="cl-eyebrow">
            caliber × canteen<span style={{ padding: '0 10px' }}>·</span>
            <b>distribution bootstrap</b><span style={{ padding: '0 10px' }}>·</span>lepton on arc
          </p>
          <h1 className="cl-hero__title" style={{ maxWidth: '17ch' }}>
            Per-event trust, priced below the fee floor<span className="cl-hero__title-dot">.</span>
          </h1>
          <p className="cl-hero__lede" style={{ maxWidth: '62ch' }}>
            Your distribution-bootstrap analysis argues that batched onchain settlement finally
            makes <b>per-event micropayments</b> viable — so you read existing APIs as payment
            surfaces and attach <b>permissionlessly</b>, as a sidecar. We built that thesis for a
            different surface: <b>agent trust</b>. An attestation API behind an x402 paywall, and
            sidecar agents that read public APIs and settle one sub-cent call at a time.
          </p>
          <div className="cl-hero__ctas">
            <Link href="/metered" className="cl-btn cl-btn--primary cl-btn--lg">see it settling live <span aria-hidden="true">→</span></Link>
            <Link href="/lepton" className="cl-btn cl-btn--ghost cl-btn--lg">the full build</Link>
          </div>
        </div>
      </section>

      {/* flow diagram */}
      <section className="cl-section cl-section--tight" style={{ paddingTop: 0 }}>
        <div className="cl-container" style={{ maxWidth: 940 }}>
          <header className="cl-section__head cl-section__head--single" style={{ marginBottom: 24 }}>
            <div>
              <span className="cl-eyebrow--section">// how a trust check settles</span>
              <h2 className="cl-h2">Five steps, one sub-cent toll<span className="cl-h2__dot">.</span></h2>
            </div>
          </header>
          <div style={{ border: '1px solid var(--hairline)', background: 'var(--paper)', padding: '26px 28px' }}>
            <TrustCheckFlow />
          </div>
          <p className="cl-sub" style={{ marginTop: 18, maxWidth: '64ch' }}>
            The agent signs an EIP-3009 authorization (no gas, no account); Circle Gateway
            <b> batches many such nanopayments into one on-chain settlement</b>, so the price
            lands under the per-transaction gas floor; Caliber returns a signed, on-chain-verifiable
            tier — and the agent pays or walks. Per-event, permissionless, below the floor.
          </p>
        </div>
      </section>

      {/* why per-event works now */}
      <section className="cl-section cl-section--tight" style={{ paddingTop: 0 }}>
        <div className="cl-container" style={{ maxWidth: 940 }}>
          <header className="cl-section__head cl-section__head--single" style={{ marginBottom: 24 }}>
            <div>
              <span className="cl-eyebrow--section">// why per-event works now</span>
              <h2 className="cl-h2">The fee floor, removed<span className="cl-h2__dot">.</span></h2>
            </div>
          </header>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 240px', border: '1px solid var(--hairline)', background: 'var(--paper)', padding: '22px 24px' }}>
              <FeeFloorBars />
              <p className="aa-foot-mono" style={{ marginTop: 10, color: 'var(--mute)', fontSize: 12 }}>
                A signed rating costs a tenth of the per-tx gas it would take to record it.
              </p>
            </div>
            <div style={{ flex: '1 1 320px', border: '1px solid var(--hairline)', background: 'var(--paper)', padding: '22px 24px' }}>
              <BatchedSettlement />
              <p className="aa-foot-mono" style={{ marginTop: 10, color: 'var(--mute)', fontSize: 12 }}>
                The buyer signs EIP-3009 (gasless); Circle settles the batch on-chain in one tx.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* the thesis, running */}
      <section className="cl-section cl-section--tight" style={{ paddingTop: 0 }}>
        <div className="cl-container" style={{ maxWidth: 940 }}>
          <header className="cl-section__head cl-section__head--single" style={{ marginBottom: 30 }}>
            <div>
              <span className="cl-eyebrow--section">// the thesis, running</span>
              <h2 className="cl-h2">Your framework, applied to agents<span className="cl-h2__dot">.</span></h2>
            </div>
          </header>
          <div className="lp-cards">
            <div className="lp-card" style={{ cursor: 'default' }}>
              <span className="lp-card__eyebrow">an API as a payment surface</span>
              <h3 className="lp-card__title">Caliber Metered</h3>
              <p className="lp-card__what">
                The signed-rating endpoint <em>is</em> the payment surface. An agent pays per query —
                no subscription, no seat. The exact &quot;per-event toll on a knowledge surface&quot;
                shape, for trust instead of citations.
              </p>
            </div>
            <div className="lp-card" style={{ cursor: 'default' }}>
              <span className="lp-card__eyebrow">permissionless sidecars</span>
              <h3 className="lp-card__title">HireBot &amp; Broker</h3>
              <p className="lp-card__what">
                Two sidecars that read the public jobs &amp; search APIs and settle per-event — no
                fork, no upstream permission. One pays only when a trust check is worth it; the
                other stakes a USDC bond on the match.
              </p>
            </div>
            <div className="lp-card" style={{ cursor: 'default' }}>
              <span className="lp-card__eyebrow">below the fee floor</span>
              <h3 className="lp-card__title">$0.001, gasless</h3>
              <p className="lp-card__what">
                Circle Gateway batches hundreds of nanopayments into one settlement; the buyer signs
                EIP-3009 and pays no gas. The price lands <em>under</em> the ~$0.01 on-chain floor —
                the constraint your analysis says onchain settlement removes.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* drop-in */}
      <section className="cl-section cl-section--ink">
        <div className="cl-container" style={{ maxWidth: 940 }}>
          <header className="cl-section__head cl-section__head--single" style={{ marginBottom: 32 }}>
            <div>
              <span className="cl-eyebrow--section">// attach in one call · zero permission</span>
              <h2 className="cl-h2">Drop it into your agent<span className="cl-h2__dot">.</span></h2>
            </div>
          </header>
          <pre style={{
            fontFamily: 'var(--font-mono)', fontSize: 13.5, lineHeight: 1.65, color: 'var(--paper)',
            background: '#0A0D12', border: '1px solid #20242B', borderLeft: '3px solid var(--copper)',
            padding: '20px 22px', overflowX: 'auto', margin: 0,
          }}>{SNIPPET}</pre>
          <p className="cl-sub" style={{ marginTop: 18 }}>
            No account, no API key, no maintainer sign-off — the agent&apos;s wallet pays the toll
            and gets a verdict it can verify on-chain. That&apos;s the distribution bootstrap: an
            existing API read as a payment surface.
          </p>
        </div>
      </section>

      {/* risk, priced and staked */}
      <section className="cl-section cl-section--tight">
        <div className="cl-container" style={{ maxWidth: 940 }}>
          <header className="cl-section__head cl-section__head--single" style={{ marginBottom: 24 }}>
            <div>
              <span className="cl-eyebrow--section">// risk, priced and staked</span>
              <h2 className="cl-h2">The broker bets on its read<span className="cl-h2__dot">.</span></h2>
            </div>
          </header>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: '1 1 360px', border: '1px solid var(--hairline)', background: 'var(--paper)', padding: '24px 26px' }}>
              <BondLadder />
            </div>
            <p className="cl-sub" style={{ flex: '1 1 280px', margin: 0 }}>
              The Bonded Broker doesn&apos;t just match — it posts a USDC bond sized by the
              provider&apos;s tier, and <b>slashes to the requester if the job fails</b>. Lower
              tier, bigger bet. The agentic part: if the expected slash loss beats its fee, it
              <b> declines the match</b> rather than take the risk.
            </p>
          </div>
        </div>
      </section>

      {/* live proof */}
      <section className="cl-section">
        <div className="cl-container" style={{ maxWidth: 940 }}>
          <header className="cl-section__head cl-section__head--single" style={{ marginBottom: 36 }}>
            <div>
              <span className="cl-eyebrow--section">// live · arc testnet</span>
              <h2 className="cl-h2">Distribution is the whole game<span className="cl-h2__dot">.</span></h2>
            </div>
          </header>
          <p className="cl-sub" style={{ marginBottom: 30, maxWidth: '60ch' }}>
            Projects &quot;die from never getting there,&quot; you wrote — distribution, not tech. So
            here are the only numbers that count, computed from chain + DB state and split by payer
            class. We never present our own traffic as outside use.
          </p>
          <div className="cl-stats">
            <div className="cl-stats__row">
              <div className="cl-stats__cell">
                <div className="cl-stats__label">per-event payments</div>
                <div className="cl-stats__value">{live.paid.toLocaleString()}</div>
                <div className="cl-stats__note">${live.earned.toFixed(3)} settled</div>
              </div>
              <div className="cl-stats__cell">
                <div className="cl-stats__label">external · demo</div>
                <div className="cl-stats__value cl-stats__value--copper">{live.external} · {live.demo}</div>
                <div className="cl-stats__note">honest split</div>
              </div>
              <div className="cl-stats__cell">
                <div className="cl-stats__label">bonds posted · slashed</div>
                <div className="cl-stats__value">{live.posted} · {live.slashed}</div>
                <div className="cl-stats__note">real USDC on the line</div>
              </div>
              <div className="cl-stats__cell">
                <div className="cl-stats__label">agent decisions</div>
                <div className="cl-stats__value">{live.decisions.toLocaleString()}</div>
                <div className="cl-stats__note">HireBot, logged verbatim</div>
              </div>
            </div>
          </div>
          <p className="aa-foot-mono" style={{ marginTop: 24, color: 'var(--mute)' }}>
            full JSON · <Link href="/api/lepton/metrics" className="cl-nav__link">/api/lepton/metrics</Link>
          </p>
        </div>
      </section>

      {/* caveat as strength + CTA */}
      <section className="cl-cta">
        <div className="cl-container cl-cta__inner">
          <div>
            <h2>A new surface for the same primitive<span className="cl-cta__dot">.</span></h2>
            <p className="cl-cta__sub">
              Your eight openings are the creator economy — music, video, photos. This is the same
              per-event-nanopayment thesis pointed at agent commerce: before one agent trusts
              another with USDC, it pays a fraction of a cent to check. Same rail, new market.
            </p>
          </div>
          <div className="cl-cta__actions">
            <Link className="cl-btn cl-btn--primary cl-btn--lg" href="/metered">fire a nanopayment <span aria-hidden="true">→</span></Link>
            <Link className="cl-btn cl-btn--ghost cl-btn--lg" href="/labs/broker">watch a bond slash</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
