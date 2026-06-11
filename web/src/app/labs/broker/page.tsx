import { notFound } from 'next/navigation';
import Link from 'next/link';
import { sql } from '@/lib/db';
import { MatchForm } from './_components/MatchForm';

// The Bonded Broker console — a Caliber Labs reference consumer (neutrality:
// it consumes ratings, it does not issue them). Caliber cl-* language.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'The Bonded Broker — Caliber Labs',
  description:
    'An autonomous matchmaker that pays Caliber per attestation, prices risk by tier, and posts a USDC bond that slashes to the requester if the job fails.',
};

const STATUS_COLOR: Record<string, string> = {
  declined: 'var(--signal-watch)', matched: 'var(--ink)', bonded: 'var(--copper)',
  released: 'var(--signal-up)', slashed: 'var(--signal-down)',
};

interface BondRow {
  id: string; status: string; provider_id: string | null; bond_usdc: string | null;
  bond_id: string | null; job_id: string | null; requester_addr: string; created_at: Date;
}

export default async function BrokerPage() {
  if (process.env.NEXT_PUBLIC_LEPTON !== '1') notFound();

  const bonds = await sql<BondRow[]>`
    SELECT id::text AS id, status, provider_id::text AS provider_id, bond_usdc,
           bond_id::text AS bond_id, job_id::text AS job_id, requester_addr, created_at
    FROM broker_matches WHERE bond_id IS NOT NULL ORDER BY id DESC LIMIT 25`;
  const [tot] = await sql<{ matches: number; declined: number; bonded: number; slashed: number }[]>`
    SELECT count(*)::int AS matches,
           count(*) FILTER (WHERE status='declined')::int AS declined,
           count(*) FILTER (WHERE bond_id IS NOT NULL)::int AS bonded,
           count(*) FILTER (WHERE status='slashed')::int AS slashed
    FROM broker_matches`;

  return (
    <main className="cl-body">
      <section className="cl-hero">
        <div className="cl-container" style={{ maxWidth: 960 }}>
          <p className="cl-eyebrow">
            caliber labs<span style={{ padding: '0 10px' }}>·</span><b>reference consumer</b>
            <span style={{ padding: '0 10px' }}>·</span>bonded broker
          </p>
          <h1 className="cl-hero__title" style={{ maxWidth: '15ch' }}>
            It stakes money on the match<span className="cl-hero__title-dot">.</span>
          </h1>
          <p className="cl-hero__lede" style={{ maxWidth: '60ch' }}>
            An autonomous matchmaker. It pays Caliber Metered for a signed attestation on
            each candidate, prices a USDC bond by the provider&apos;s tier, and — the
            agentic part — <b>declines the match when the expected slash loss exceeds its
            fee</b>. On accept it posts the bond, which slashes to the requester if the job
            is rejected or expires.
          </p>
        </div>
      </section>

      <section className="cl-section cl-section--tight" style={{ paddingTop: 0 }}>
        <div className="cl-container" style={{ maxWidth: 960 }}>
          <div className="lp-what" style={{ marginBottom: 14 }}>
            <span className="lp-what__k">// what is this</span>
            <p>
              Ask for a provider in a category at a job value. The broker shortlists, buys a
              signed rating for each (real x402 payments), then runs the decline rule:
              <b> if p(fail) × bond &gt; fee, walk away</b>. Accept → it posts the bond
              on-chain; the keeper releases or slashes it when the job settles.
            </p>
          </div>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--mute)', margin: '0 0 30px' }}>
            <b style={{ color: 'var(--ink)' }}>Neutrality.</b> Caliber rates; this product
            consumes ratings. Independent of rating issuance.
          </p>

          {/* console */}
          <div style={{ border: '1px solid var(--hairline)', background: 'var(--color-bg-elev)', padding: '24px 24px 22px', marginBottom: 40 }}>
            <span className="cl-eyebrow--section">// request a match</span>
            <h2 className="cl-h2" style={{ fontSize: 'clamp(24px,3vw,32px)', margin: '4px 0 16px' }}>
              Find me a provider<span className="cl-h2__dot">.</span>
            </h2>
            <MatchForm />
          </div>

          {/* bond board */}
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <span className="cl-eyebrow--section" style={{ marginBottom: 4 }}>// bond board</span>
              <h2 className="cl-h2" style={{ fontSize: 'clamp(24px,3vw,32px)' }}>Money on the line<span className="cl-h2__dot">.</span></h2>
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--mute)' }}>
              {tot?.matches ?? 0} matches · {tot?.declined ?? 0} declined · {tot?.bonded ?? 0} bonded · {tot?.slashed ?? 0} slashed
            </span>
          </header>
          {bonds.length === 0 ? (
            <p className="aa-foot-mono">No bonds posted yet — run a match above (needs a real job to bond on-chain).</p>
          ) : (
            <ol style={{ listStyle: 'none', padding: 0, margin: 0, border: '1px solid var(--hairline)' }}>
              {bonds.map((b, i) => (
                <li key={b.id} style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', padding: '11px 16px', borderTop: i ? '1px solid var(--hairline)' : 'none', background: b.status === 'slashed' ? 'rgba(180,35,24,0.05)' : undefined }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: STATUS_COLOR[b.status] ?? 'var(--mute)', minWidth: 66, textTransform: 'uppercase' }}>{b.status}</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>bond #{b.bond_id}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--copper)' }}>${Number(b.bond_usdc ?? 0).toFixed(2)}</span>
                  {b.provider_id ? <Link href={`/passport/arc/${b.provider_id}`} className="cl-nav__link" style={{ fontFamily: 'var(--font-mono)' }}>provider #{b.provider_id}</Link> : null}
                  {b.job_id ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--mute)' }}>job #{b.job_id}</span> : null}
                  <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--mute)' }}>{new Date(b.created_at).toISOString().slice(0, 16).replace('T', ' ')}</span>
                </li>
              ))}
            </ol>
          )}

          <p className="aa-foot-mono" style={{ marginTop: 30, color: 'var(--mute)' }}>
            ← <Link href="/lepton" className="cl-nav__link">Lepton overview</Link> · powered by <Link href="/metered" className="cl-nav__link">Caliber Metered</Link> · tier-priced bonds → <Link href="/integrate" className="cl-nav__link">/integrate</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
