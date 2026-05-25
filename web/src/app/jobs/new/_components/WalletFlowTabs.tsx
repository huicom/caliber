'use client';

import { useState } from 'react';

type Flow = 'metamask' | 'circle';

const FLOWS: Record<Flow, { label: string; steps: [string, string][] }> = {
  metamask: {
    label: 'metamask',
    steps: [
      ['popup #1', 'Approve USDC to RatingGateway'],
      ['popup #2', 'Post job — gateway verifies Caliber attestation, escrows USDC into AgenticCommerce'],
    ],
  },
  circle: {
    label: 'circle pw',
    steps: [
      ['pin #1', 'Deposit USDC to Gateway Wallet (one-time per wallet)'],
      ['pin #2', 'Approve USDC to RatingGateway'],
      ['pin #3', 'Sign x402 — gasless attestation fee (0.001 USDC)'],
      ['pin #4', 'Post job — gateway verifies + escrows USDC'],
    ],
  },
};

export function WalletFlowTabs() {
  const [active, setActive] = useState<Flow>('metamask');
  const flow = FLOWS[active];

  return (
    <section>
      <p className="aa-eyebrow" style={{ marginBottom: 12 }}>{'{wallet_flows}'}</p>

      <div
        role="tablist"
        aria-label="Wallet flow"
        style={{
          display: 'flex',
          gap: 16,
          marginBottom: 16,
          fontFamily: 'var(--font-family-mono)',
          fontSize: 11,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        {(Object.keys(FLOWS) as Flow[]).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={active === key}
            onClick={() => setActive(key)}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '4px 0',
              cursor: 'pointer',
              color: active === key ? 'var(--color-ink)' : 'var(--color-mute)',
              borderBottom: `1px solid ${active === key ? 'var(--color-copper)' : 'transparent'}`,
              fontFamily: 'inherit',
              fontSize: 'inherit',
              letterSpacing: 'inherit',
              textTransform: 'inherit',
            }}
          >
            {FLOWS[key].label}
          </button>
        ))}
      </div>

      <ol
        role="tabpanel"
        style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}
      >
        {flow.steps.map(([label, body]) => (
          <li key={label} style={{ display: 'flex', gap: 12 }}>
            <span
              style={{
                fontFamily: 'var(--font-family-mono)',
                fontSize: 10,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--color-copper)',
                flexShrink: 0,
                paddingTop: 2,
                width: 64,
              }}
            >
              {label}
            </span>
            <span style={{ color: 'var(--color-mute)', fontSize: 14, lineHeight: 1.5 }}>
              {body}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
