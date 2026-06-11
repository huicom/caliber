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
  Gold: 'var(--tier-gold)', Silver: 'var(--tier-silver)', Bronze: 'var(--tier-bronze)',
  Pending: 'var(--tier-pending)', Watch: 'var(--tier-watch)', Dormant: 'var(--tier-dormant)',
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
        className="cl-btn cl-btn--primary cl-btn--lg"
        style={{ cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1 }}
      >
        {loading ? 'paying…' : <>fire a real nanopayment <span aria-hidden="true">→</span></>}
      </button>

      {res ? (
        <div style={{ marginTop: 16, padding: 16, border: '1px solid var(--hairline)', background: 'var(--paper)' }}>
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
            <p style={{ margin: 0, color: res.error === 'rate_limited' || res.error === 'daily_cap' ? 'var(--signal-watch)' : 'var(--signal-down)' }}>
              {res.message ?? res.error ?? 'Something went wrong.'}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
