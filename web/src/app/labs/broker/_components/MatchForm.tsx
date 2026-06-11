'use client';

import { useState } from 'react';
import Link from 'next/link';

interface Step { step: string; detail: string; ref?: string }
interface MatchResult {
  matchId?: string;
  status?: 'declined' | 'matched' | 'bonded';
  providerId?: string | null;
  feeUsdc?: number;
  bondUsdc?: number | null;
  bondId?: string | null;
  txHash?: string | null;
  attestationsBought?: number;
  declineReason?: string | null;
  decisionLog?: Step[];
  error?: string;
  message?: string;
}

const STEP_COLOR: Record<string, string> = {
  request: '#475569', discover: '#475569', attestation: '#1D4ED8',
  evaluate: '#475569', accept: '#15803D', decline: '#B45309',
  verdict: '#0F172A', bond: '#7C3AED',
};

export function MatchForm() {
  const [category, setCategory] = useState('research');
  const [minTier, setMinTier] = useState('Bronze');
  const [jobValue, setJobValue] = useState('50');
  const [maxFee, setMaxFee] = useState('');
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<MatchResult | null>(null);

  async function findProvider() {
    setLoading(true);
    setRes(null);
    try {
      const r = await fetch('/api/broker/match', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requesterAddr: '0xD8f2c3A6bD1E0cFF9b9ffB62bb6C5EfE30e6B667',
          jobValueUsdc: Number(jobValue) || 0,
          category,
          minTier,
          maxFeeUsdc: maxFee ? Number(maxFee) : undefined,
        }),
      });
      setRes((await r.json()) as MatchResult);
    } catch {
      setRes({ error: 'network', message: 'Request failed.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <Field label="category"><input value={category} onChange={(e) => setCategory(e.target.value)} style={inp} /></Field>
        <Field label="min tier">
          <select value={minTier} onChange={(e) => setMinTier(e.target.value)} style={inp}>
            {['Gold', 'Silver', 'Bronze', 'Pending'].map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="job value $"><input value={jobValue} onChange={(e) => setJobValue(e.target.value)} style={{ ...inp, width: 90 }} /></Field>
        <Field label="max fee $ (opt)"><input value={maxFee} onChange={(e) => setMaxFee(e.target.value)} placeholder="—" style={{ ...inp, width: 90 }} /></Field>
        <button onClick={findProvider} disabled={loading} style={{ background: '#0F172A', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 8, fontWeight: 600, cursor: loading ? 'wait' : 'pointer', height: 38 }}>
          {loading ? 'matching…' : 'Find me a provider'}
        </button>
      </div>

      {res ? (
        res.error ? (
          <p style={{ color: '#B91C1C' }}>{res.message ?? res.error}</p>
        ) : (
          <div>
            {/* Verdict banner */}
            <div className="aa-card" style={{ padding: '12px 16px', marginBottom: 14, borderLeft: `4px solid ${res.status === 'declined' ? '#B45309' : '#15803D'}` }}>
              <strong style={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 13, color: res.status === 'declined' ? '#B45309' : '#15803D' }}>{res.status}</strong>
              {res.status !== 'declined' ? (
                <span style={{ marginLeft: 10 }}>
                  provider <Link href={`/passport/arc/${res.providerId}`} className="aa-mono aa-link">#{res.providerId}</Link>
                  {' · '}fee ${res.feeUsdc?.toFixed(4)} · bond ${res.bondUsdc?.toFixed(2)}
                  {res.bondId ? <> · bond #{res.bondId}{res.txHash ? <> (<span className="aa-mono">{res.txHash.slice(0, 12)}…</span>)</> : null}</> : null}
                </span>
              ) : (
                <span style={{ marginLeft: 10 }}>{res.declineReason}</span>
              )}
              <div className="aa-foot-mono" style={{ marginTop: 4 }}>{res.attestationsBought} attestation(s) bought this match</div>
            </div>

            {/* Payment-chain viz */}
            <PaymentChain res={res} />

            {/* Reasoning stream */}
            <ol style={{ listStyle: 'none', padding: 0, margin: '14px 0 0', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {(res.decisionLog ?? []).map((s, i) => (
                <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: STEP_COLOR[s.step] ?? '#475569', minWidth: 78, textTransform: 'uppercase' }}>{s.step}</span>
                  <span style={{ fontSize: 13.5, lineHeight: 1.4 }}>
                    {s.detail}
                    {s.ref ? <span className="aa-mono aa-foot-mono"> · {s.ref.slice(0, 14)}…</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )
      ) : null}
    </div>
  );
}

function PaymentChain({ res }: { res: MatchResult }) {
  const hops = [
    { label: 'Requester', sub: `fee $${res.feeUsdc?.toFixed(2) ?? '0'}`, on: res.status !== 'declined' },
    { label: 'Broker', sub: `${res.attestationsBought ?? 0} × attest`, on: true },
    { label: 'Caliber', sub: 'signed rating', on: (res.attestationsBought ?? 0) > 0 },
    { label: 'Bond', sub: res.bondUsdc != null ? `$${res.bondUsdc.toFixed(2)}` : '—', on: res.status === 'bonded' },
    { label: 'Settle', sub: 'release/slash', on: res.status === 'bonded' },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
      {hops.map((h, i) => (
        <span key={h.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ textAlign: 'center', padding: '6px 10px', borderRadius: 7, background: h.on ? '#0F172A' : '#E2E8F0', color: h.on ? '#fff' : '#94A3B8', fontSize: 12, minWidth: 72 }}>
            <div style={{ fontWeight: 600 }}>{h.label}</div>
            <div style={{ fontSize: 10, opacity: 0.85 }}>{h.sub}</div>
          </span>
          {i < hops.length - 1 ? <span style={{ color: h.on ? '#0F172A' : '#CBD5E1' }}>→</span> : null}
        </span>
      ))}
    </div>
  );
}

const inp: React.CSSProperties = { padding: '8px 10px', borderRadius: 7, border: '1px solid #CBD5E1', fontSize: 14, height: 38, boxSizing: 'border-box' };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span className="aa-foot-mono" style={{ fontSize: 11 }}>{label}</span>
      {children}
    </label>
  );
}
