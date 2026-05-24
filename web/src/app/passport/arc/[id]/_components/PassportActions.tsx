'use client';

import { useState } from 'react';

interface Props {
  chain: string;
  agentId: string;
  agentName: string;
  passportUrl: string;
}

const RATING_API_BASE =
  process.env.NEXT_PUBLIC_RATING_API_BASE ?? 'https://caliber-api.poko.blue';

// Client-only Passport CTAs. Three actions:
//   1. Download — fetches a freshly-signed EIP-712 attestation and saves it
//   2. Verify   — opens /verify pre-filled with this agent's identifiers
//   3. Embed    — copies a one-line <script> tag the agent can drop on their
//                 own site to render a live Caliber badge
export function PassportActions({ chain, agentId, agentName, passportUrl }: Props) {
  const [downloadState, setDownloadState] = useState<'idle' | 'fetching' | 'ok' | 'err'>('idle');
  const [embedState, setEmbedState] = useState<'idle' | 'copied'>('idle');

  async function downloadAttestation() {
    setDownloadState('fetching');
    try {
      const res = await fetch(`${RATING_API_BASE}/v1/agents/${chain}/${agentId}/attest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ minTier: 'Dormant' }), // unconditional fetch — always returns current attestation
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `caliber-attestation-${chain}-${agentId}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDownloadState('ok');
      setTimeout(() => setDownloadState('idle'), 2200);
    } catch {
      setDownloadState('err');
      setTimeout(() => setDownloadState('idle'), 2200);
    }
  }

  function copyEmbed() {
    const snippet = `<script src="https://caliber.poko.blue/embed.js" data-chain="${chain}" data-agent-id="${agentId}" async></script>`;
    void navigator.clipboard.writeText(snippet).then(() => {
      setEmbedState('copied');
      setTimeout(() => setEmbedState('idle'), 1800);
    });
  }

  return (
    <section className="space-y-3">
      <h2 className="font-mono text-[13px] text-[var(--color-ink)] tracking-[0.02em]">
        //take_this_with_you
      </h2>
      <p className="text-sm text-[var(--color-mute)] leading-snug">
        This rating is a signed claim, not a marketing badge. {agentName} or anyone else can carry it to a smart
        contract, an audit trail, or their own website — and anyone can verify the signature against the on-chain{' '}
        <code className="font-mono text-xs">RatingVerifier</code>.
      </p>

      <div className="grid sm:grid-cols-3 gap-2 pt-1">
        <button
          onClick={downloadAttestation}
          disabled={downloadState === 'fetching'}
          className="aa-btn aa-btn--primary text-sm py-3 disabled:opacity-50 disabled:cursor-wait"
        >
          {downloadState === 'fetching'
            ? 'fetching…'
            : downloadState === 'ok'
              ? '✓ saved'
              : downloadState === 'err'
                ? '× try again'
                : 'download attestation'}
        </button>

        <a
          href={`/verify?chain=${chain}&id=${agentId}`}
          className="aa-btn aa-btn--ghost text-sm py-3 text-center"
        >
          verify on-chain
        </a>

        <button onClick={copyEmbed} className="aa-btn aa-btn--ghost text-sm py-3">
          {embedState === 'copied' ? '✓ embed copied' : 'copy embed code'}
        </button>
      </div>

      <p className="font-mono text-[10px] text-[var(--color-mute)] mt-2 leading-snug">
        // attestation: EIP-712 signed by Caliber · methodology v2.0.1 · verifies on Arc Testnet
        <br />
        // share: <a href={passportUrl} className="text-[var(--color-copper)] hover:underline">{passportUrl}</a>
      </p>
    </section>
  );
}
