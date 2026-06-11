import { notFound } from 'next/navigation';
import Link from 'next/link';
import { sql } from '@/lib/db';
import { MatchForm } from './_components/MatchForm';

// Lepton Phase 2 (B3): the Bonded Broker console. Neutrality (Guardrail 3):
// this is a Caliber Labs reference *consumer* — it consumes ratings, it does
// not issue them.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'The Bonded Broker — Caliber Labs',
  description:
    'An autonomous matchmaker that pays Caliber per attestation, prices risk by tier, and posts a USDC bond that slashes to the requester if the job fails.',
};

const STATUS_COLOR: Record<string, string> = {
  declined: '#B45309', matched: '#1D4ED8', bonded: '#7C3AED', released: '#15803D', slashed: '#B91C1C',
};

interface BondRow {
  id: string;
  status: string;
  provider_id: string | null;
  bond_usdc: string | null;
  bond_id: string | null;
  job_id: string | null;
  requester_addr: string;
  created_at: Date;
}

export default async function BrokerPage() {
  if (process.env.NEXT_PUBLIC_LEPTON !== '1') notFound();

  const bonds = await sql<BondRow[]>`
    SELECT id::text AS id, status, provider_id::text AS provider_id, bond_usdc,
           bond_id::text AS bond_id, job_id::text AS job_id, requester_addr, created_at
    FROM broker_matches WHERE bond_id IS NOT NULL ORDER BY id DESC LIMIT 25`;

  const [tot] = await sql<{ matches: number; declined: number; bonded: number }[]>`
    SELECT count(*)::int AS matches,
           count(*) FILTER (WHERE status='declined')::int AS declined,
           count(*) FILTER (WHERE bond_id IS NOT NULL)::int AS bonded
    FROM broker_matches`;

  return (
    <main className="aa-shell" style={{ maxWidth: 960, margin: '0 auto', padding: '2.5rem 1.25rem 4rem' }}>
      <p className="aa-foot-mono" style={{ marginBottom: 8 }}>caliber labs · reference consumer</p>
      <h1 className="aa-h1" style={{ marginBottom: 6 }}>The Bonded Broker</h1>
      <p className="aa-lede" style={{ marginBottom: 14, maxWidth: 680 }}>
        An autonomous matchmaker. It pays Caliber Metered for a signed attestation
        on each candidate, prices a USDC bond by the provider&apos;s tier, and —
        the agentic part — <strong>declines the match when the expected slash loss
        exceeds its fee</strong>. On accept it posts the bond, which slashes to the
        requester if the job is rejected or expires.
      </p>
      <div className="aa-card" style={{ padding: '10px 14px', marginBottom: 26, fontSize: 13, background: '#F8FAFC', color: '#475569' }}>
        <strong>Neutrality:</strong> Caliber Labs reference consumer — independent of rating issuance.
        Caliber rates; this product consumes ratings.
      </div>

      {/* Console */}
      <section className="aa-card" style={{ padding: 22, marginBottom: 30 }}>
        <h2 className="aa-h2" style={{ marginTop: 0, marginBottom: 14 }}>Request a match</h2>
        <MatchForm />
      </section>

      {/* Bond board */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <h2 className="aa-h2" style={{ margin: 0 }}>Bond board</h2>
        <span className="aa-foot-mono">{tot?.matches ?? 0} matches · {tot?.declined ?? 0} declined · {tot?.bonded ?? 0} bonded</span>
      </div>
      {bonds.length === 0 ? (
        <p className="aa-foot-mono">No bonds posted yet — run a match above (needs a real job to bond on-chain).</p>
      ) : (
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {bonds.map((b) => (
            <li key={b.id} className="aa-card" style={{ padding: '10px 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', background: b.status === 'slashed' ? '#FEF2F2' : undefined }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLOR[b.status] ?? '#475569', minWidth: 70 }}>{b.status}</span>
              <span className="aa-mono">bond #{b.bond_id}</span>
              <span className="aa-mono">${Number(b.bond_usdc ?? 0).toFixed(2)}</span>
              {b.provider_id ? <Link href={`/passport/arc/${b.provider_id}`} className="aa-mono aa-link">provider #{b.provider_id}</Link> : null}
              {b.job_id ? <span className="aa-foot-mono">job #{b.job_id}</span> : null}
              <span className="aa-foot-mono" style={{ marginLeft: 'auto' }}>{new Date(b.created_at).toISOString().slice(0, 16).replace('T', ' ')}</span>
            </li>
          ))}
        </ol>
      )}

      <p className="aa-foot-mono" style={{ marginTop: 28 }}>
        Powered by <Link href="/metered" className="aa-link">Caliber Metered</Link> · tier-priced bonds per <Link href="/integrate" className="aa-link">/integrate</Link>
      </p>
    </main>
  );
}
