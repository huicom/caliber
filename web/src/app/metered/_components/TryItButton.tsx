'use client';

import { useState } from 'react';
import Link from 'next/link';

interface TryItResult {
  ok?: boolean;
  error?: string;
  message?: string;
  agentId?: string;
  tier?: string;
  score?: number;
  confidence?: string;
  amountUsdc?: string;
  paymentRef?: string;
  passportUrl?: string;
}

const TIER_COLOR: Record<string, string> = {
  Gold: '#B8862B', Silver: '#7E8690', Bronze: '#8C5A2C',
  Pending: '#98948C', Watch: '#B45309', Dormant: '#A8A39A',
};

export function TryItButton() {
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<TryItResult | null>(null);

  async function fire() {
    setLoading(true);
    setRes(null);
    try {
      const r = await fetch('/api/metered/try-it', { method: 'POST' });
      setRes((await r.json()) as TryItResult);
    } catch {
      setRes({ error: 'network', message: 'Request failed — try again.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={fire}
        disabled={loading}
        className="aa-btn"
        style={{
          background: '#1D4ED8', color: '#fff', border: 'none', padding: '12px 22px',
          borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? 'paying…' : 'Fire a real nanopayment →'}
      </button>

      {res ? (
        <div className="aa-card" style={{ marginTop: 16, padding: 16 }}>
          {res.ok ? (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 16 }}>Agent #{res.agentId}</strong>
                <span style={{ color: TIER_COLOR[res.tier ?? ''] ?? '#555', fontWeight: 700 }}>{res.tier}</span>
                <span className="aa-mono">score {res.score}</span>
                <span className="aa-foot-mono">{res.confidence} confidence</span>
              </div>
              <div className="aa-foot-mono" style={{ marginTop: 8, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <span>paid <strong>${res.amountUsdc}</strong> USDC</span>
                <span>settle ref <span className="aa-mono">{(res.paymentRef ?? '').slice(0, 18)}…</span></span>
                {res.passportUrl ? <Link href={res.passportUrl} className="aa-link">view passport →</Link> : null}
              </div>
              <p className="aa-foot-mono" style={{ marginTop: 8, opacity: 0.7 }}>
                Settled off-chain in a Circle Gateway batch — no gas paid by the buyer.
              </p>
            </>
          ) : (
            <p style={{ margin: 0, color: res.error === 'rate_limited' || res.error === 'daily_cap' ? '#B45309' : '#B91C1C' }}>
              {res.message ?? res.error ?? 'Something went wrong.'}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
