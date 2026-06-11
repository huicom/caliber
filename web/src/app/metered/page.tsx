import { notFound } from 'next/navigation';
import Link from 'next/link';
import { sql } from '@/lib/db';
import { TryItButton } from './_components/TryItButton';

// Lepton Phase 1 (A3): the Caliber Metered surface. Revenue ticker (honest,
// split by payer class), a live paid-request feed, and a judge "Try it" button
// that fires a real sub-cent nanopayment. Behind NEXT_PUBLIC_LEPTON.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'Caliber Metered — pay-per-rating API',
  description:
    'The Caliber attestation API behind an x402 paywall: sub-cent USDC per signed rating via Circle Gateway Nanopayments.',
};

const TIER_COLOR: Record<string, string> = {
  Gold: '#B8862B', Silver: '#7E8690', Bronze: '#8C5A2C',
  Pending: '#98948C', Watch: '#B45309', Dormant: '#A8A39A',
};

interface FeedRow {
  id: string;
  created_at: Date;
  payer_class: string;
  amount_usdc: string;
  agent_id: string | null;
  latency_ms: number | null;
  status: string;
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

  // Ticker: paid requests = real settlements (amount > 0). External is the only
  // class that counts as outside use; demo is our own controlled traffic.
  const [agg] = await sql<
    { served: number; earned: number; payers: number; external: number; demo: number }[]
  >`
    SELECT
      count(*) FILTER (WHERE amount_usdc > 0)::int                                   AS served,
      COALESCE(SUM(amount_usdc) FILTER (WHERE payer_class <> 'internal'), 0)::float8  AS earned,
      count(DISTINCT payer_address) FILTER (WHERE amount_usdc > 0)::int               AS payers,
      count(*) FILTER (WHERE amount_usdc > 0 AND payer_class = 'external')::int        AS external,
      count(*) FILTER (WHERE amount_usdc > 0 AND payer_class = 'demo')::int            AS demo
    FROM metered_payments`;

  const served = agg?.served ?? 0;
  const earned = agg?.earned ?? 0;
  const payers = agg?.payers ?? 0;
  const external = agg?.external ?? 0;
  const demo = agg?.demo ?? 0;

  const feed = await sql<FeedRow[]>`
    SELECT id, created_at, payer_class, amount_usdc, agent_id, latency_ms, status
    FROM metered_payments
    WHERE amount_usdc > 0
    ORDER BY id DESC LIMIT 20`;

  return (
    <main className="aa-shell" style={{ maxWidth: 920, margin: '0 auto', padding: '2.5rem 1.25rem 4rem' }}>
      <p className="aa-foot-mono" style={{ marginBottom: 8 }}>caliber metered · x402</p>
      <h1 className="aa-h1" style={{ marginBottom: 6 }}>Pay-per-rating, priced like a phone call</h1>
      <p className="aa-lede" style={{ marginBottom: 28, maxWidth: 660 }}>
        Caliber&apos;s signed attestation API sits behind an x402 paywall: an agent
        pays a sub-cent USDC nanopayment via Circle Gateway and gets back a
        cryptographically signed rating — gasless, settled off-chain in a batch.
        Free reads stay free; the paid endpoint is for agents that need proof.
      </p>

      {/* Ticker */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 10 }}>
        <Stat label="attestations served" value={served.toLocaleString()} />
        <Stat label="USDC earned" value={`$${earned.toFixed(3)}`} />
        <Stat label="unique payers" value={payers.toLocaleString()} />
      </section>
      <p className="aa-foot-mono" style={{ marginBottom: 28, opacity: 0.75 }}>
        honest split · <strong style={{ color: '#15803D' }}>{external}</strong> external · {demo} demo —
        we never present our own traffic as outside users.
      </p>

      {/* Try it */}
      <section className="aa-card" style={{ padding: 22, marginBottom: 30 }}>
        <h2 className="aa-h2" style={{ marginTop: 0, marginBottom: 6 }}>Fire one yourself</h2>
        <p style={{ marginTop: 0, marginBottom: 16, fontSize: 14, maxWidth: 560 }}>
          One click runs a real paid request from a faucet-funded demo wallet
          through the genuine x402 path (not a bypass) and returns the signed
          attestation it bought. Rate-limited to one per minute.
        </p>
        <TryItButton />
      </section>

      {/* Live feed */}
      <h2 className="aa-h2" style={{ marginBottom: 12 }}>Live paid requests</h2>
      {feed.length === 0 ? (
        <p className="aa-foot-mono">No paid requests yet — fire the first one above.</p>
      ) : (
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {feed.map((r) => (
            <li key={r.id} className="aa-card" style={{ padding: '10px 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 5,
                color: r.payer_class === 'external' ? '#15803D' : '#7E8690',
                background: r.payer_class === 'external' ? '#15803D15' : '#7E869015' }}>
                {r.payer_class}
              </span>
              <span className="aa-mono">${Number(r.amount_usdc).toFixed(4)}</span>
              {r.agent_id ? (
                <Link href={`/passport/arc/${r.agent_id}`} className="aa-mono aa-link">agent #{r.agent_id}</Link>
              ) : <span className="aa-foot-mono">—</span>}
              <span className="aa-foot-mono" style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
                {r.latency_ms != null ? <span>{r.latency_ms}ms</span> : null}
                <span>{relTime(r.created_at)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}

      <p className="aa-foot-mono" style={{ marginTop: 28 }}>
        Pricing &amp; integration → <Link href="/integrate" className="aa-link">/integrate</Link> ·
        budget agent in action → <Link href="/labs/hirebot" className="aa-link">HireBot</Link>
      </p>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="aa-card" style={{ padding: 18 }}>
      <div className="aa-foot-mono" style={{ marginBottom: 6 }}>{label}</div>
      <div className="aa-mono" style={{ fontSize: 26, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
