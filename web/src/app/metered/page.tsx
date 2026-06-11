import { notFound } from 'next/navigation';
import Link from 'next/link';
import { sql } from '@/lib/db';
import { TryItButton } from './_components/TryItButton';

// Caliber Metered — pay-per-rating x402 surface, in Caliber's cl-* editorial
// language. Behind NEXT_PUBLIC_LEPTON.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'Caliber Metered — pay-per-rating API',
  description:
    'The Caliber attestation API behind an x402 paywall: sub-cent USDC per signed rating via Circle Gateway Nanopayments.',
};

interface FeedRow {
  id: string; created_at: Date; payer_class: string; amount_usdc: string;
  agent_id: string | null; latency_ms: number | null; status: string;
}

function relTime(d: Date): string {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default async function MeteredPage() {
  if (process.env.NEXT_PUBLIC_LEPTON !== '1') notFound();

  const [agg] = await sql<{ served: number; earned: number; payers: number; external: number; demo: number }[]>`
    SELECT count(*) FILTER (WHERE amount_usdc > 0)::int AS served,
           COALESCE(SUM(amount_usdc) FILTER (WHERE payer_class <> 'internal'),0)::float8 AS earned,
           count(DISTINCT payer_address) FILTER (WHERE amount_usdc > 0)::int AS payers,
           count(*) FILTER (WHERE amount_usdc > 0 AND payer_class='external')::int AS external,
           count(*) FILTER (WHERE amount_usdc > 0 AND payer_class='demo')::int AS demo
    FROM metered_payments`;
  const served = agg?.served ?? 0, earned = agg?.earned ?? 0, payers = agg?.payers ?? 0;
  const external = agg?.external ?? 0, demo = agg?.demo ?? 0;

  const feed = await sql<FeedRow[]>`
    SELECT id, created_at, payer_class, amount_usdc, agent_id, latency_ms, status
    FROM metered_payments WHERE amount_usdc > 0 ORDER BY id DESC LIMIT 18`;

  return (
    <main className="cl-body">
      <section className="cl-hero">
        <div className="cl-container" style={{ maxWidth: 920 }}>
          <p className="cl-eyebrow">
            caliber metered<span style={{ padding: '0 10px' }}>·</span><b>x402 paywall</b>
            <span style={{ padding: '0 10px' }}>·</span>circle gateway nanopayments
          </p>
          <h1 className="cl-hero__title" style={{ maxWidth: '15ch' }}>
            Pay-per-rating, priced like a call<span className="cl-hero__title-dot">.</span>
          </h1>
          <p className="cl-hero__lede" style={{ maxWidth: '58ch' }}>
            An agent pays a sub-cent USDC nanopayment and gets back a cryptographically
            signed Caliber rating — gasless, settled off-chain in a batch. Free reads stay
            free; the paid endpoint is for agents that need <b>verifiable</b> proof.
          </p>
        </div>
      </section>

      <section className="cl-section cl-section--tight" style={{ paddingTop: 0 }}>
        <div className="cl-container" style={{ maxWidth: 920 }}>
          <div className="lp-what" style={{ marginBottom: 36 }}>
            <span className="lp-what__k">// what is this</span>
            <p>
              A storefront for agents. <b>POST</b> an agent ID, get a 402 with payment
              terms, sign an EIP-3009 authorization, retry — and a signed attestation comes
              back. Circle batches hundreds of these into one settlement, so each query
              costs a fraction of a cent, <b>below</b> the on-chain gas floor.
            </p>
          </div>

          {/* ticker */}
          <div className="cl-stats" style={{ marginBottom: 12 }}>
            <div className="cl-stats__row">
              <div className="cl-stats__cell">
                <div className="cl-stats__label">attestations served</div>
                <div className="cl-stats__value">{served.toLocaleString()}</div>
                <div className="cl-stats__note">paid rating queries</div>
              </div>
              <div className="cl-stats__cell">
                <div className="cl-stats__label">USDC earned</div>
                <div className="cl-stats__value cl-stats__value--copper">${earned.toFixed(3)}</div>
                <div className="cl-stats__note">settled in Gateway balance</div>
              </div>
              <div className="cl-stats__cell">
                <div className="cl-stats__label">unique payers</div>
                <div className="cl-stats__value">{payers.toLocaleString()}</div>
                <div className="cl-stats__note">distinct wallets</div>
              </div>
            </div>
          </div>
          <p className="lp-honest" style={{ marginBottom: 40 }}>
            honest split · <b>{external}</b> external · {demo} demo — our own traffic is
            never presented as outside use.
          </p>

          {/* try it */}
          <div style={{ border: '1px solid var(--hairline)', background: 'var(--color-bg-elev)', padding: '26px 26px 22px', marginBottom: 44 }}>
            <span className="cl-eyebrow--section">// try it</span>
            <h2 className="cl-h2" style={{ fontSize: 'clamp(26px,3vw,34px)', margin: '4px 0 10px' }}>
              Fire one yourself<span className="cl-h2__dot">.</span>
            </h2>
            <p className="cl-sub" style={{ marginBottom: 18 }}>
              One click runs a real paid request from a faucet-funded demo wallet through the
              genuine x402 path — not a bypass — and returns the signed attestation it bought.
              Rate-limited to one per minute.
            </p>
            <TryItButton />
          </div>

          {/* feed */}
          <header className="cl-section__head cl-section__head--single" style={{ marginBottom: 18 }}>
            <div>
              <span className="cl-eyebrow--section">// live · paid requests</span>
              <h2 className="cl-h2" style={{ fontSize: 'clamp(26px,3vw,34px)' }}>The toll, in the open<span className="cl-h2__dot">.</span></h2>
            </div>
          </header>
          {feed.length === 0 ? (
            <p className="aa-foot-mono">No paid requests yet — fire the first one above.</p>
          ) : (
            <ol style={{ listStyle: 'none', padding: 0, margin: 0, border: '1px solid var(--hairline)' }}>
              {feed.map((r, i) => (
                <li key={r.id} style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', padding: '11px 16px', borderTop: i ? '1px solid var(--hairline)' : 'none', fontSize: 14 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: r.payer_class === 'external' ? 'var(--signal-up)' : 'var(--mute)', minWidth: 56 }}>{r.payer_class}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--copper)' }}>${Number(r.amount_usdc).toFixed(4)}</span>
                  {r.agent_id ? <Link href={`/passport/arc/${r.agent_id}`} className="cl-nav__link" style={{ fontFamily: 'var(--font-mono)' }}>agent #{r.agent_id}</Link> : <span className="aa-mute">—</span>}
                  <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--mute)', display: 'flex', gap: 12 }}>
                    {r.latency_ms != null ? <span>{r.latency_ms}ms</span> : null}
                    <span>{relTime(r.created_at)}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}

          <p className="aa-foot-mono" style={{ marginTop: 30, color: 'var(--mute)' }}>
            ← <Link href="/lepton" className="cl-nav__link">Lepton overview</Link> · pricing &amp; integration → <Link href="/integrate" className="cl-nav__link">/integrate</Link> · budget agent → <Link href="/labs/hirebot" className="cl-nav__link">HireBot</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
