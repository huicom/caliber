import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';
export const contentType = 'image/png';
export const size = { width: 1200, height: 630 };

interface Totals {
  agents: number;
  completedJobs: number;
  usdcVolume: string;
}

async function fetchTotals(): Promise<Totals> {
  try {
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
    const res = await fetch(`${base}/api/stats`, { next: { revalidate: 60 } });
    const json = await res.json();
    return {
      agents: Number(json?.totals?.agents ?? 0),
      completedJobs: Number(json?.totals?.completedJobs ?? 0),
      usdcVolume: String(json?.totals?.usdcVolume ?? '0'),
    };
  } catch {
    return { agents: 0, completedJobs: 0, usdcVolume: '0' };
  }
}

function formatUsdc(s: string): string {
  const n = parseFloat(s);
  if (!isFinite(n)) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toFixed(0);
}

export default async function Image() {
  const t = await fetchTotals();

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#0A0A0B',
          color: '#F5F5F5',
          padding: '72px 80px',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* Eyebrow */}
        <div
          style={{
            display: 'flex',
            fontFamily: 'monospace',
            fontSize: 18,
            letterSpacing: 4,
            color: '#6B6B75',
            marginBottom: 32,
          }}
        >
          {'{arc_agent_explorer}'}
        </div>

        {/* Mark + wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 36 }}>
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
            <path
              d="M3 17 A 9 9 0 0 1 21 17"
              stroke="#00D4A8"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <circle cx="12" cy="20" r="1.6" fill="#00D4A8" />
          </svg>
          <span style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em' }}>
            ArcAgents
          </span>
        </div>

        {/* Headline */}
        <h1
          style={{
            fontSize: 84,
            fontWeight: 600,
            letterSpacing: '-0.03em',
            lineHeight: 1.05,
            margin: 0,
            marginBottom: 24,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <span>Every AI agent on Arc,</span>
          <span style={{ color: '#00D4A8' }}>in one place.</span>
        </h1>

        {/* Stat row */}
        <div
          style={{
            display: 'flex',
            gap: 64,
            marginTop: 'auto',
            paddingTop: 40,
            borderTop: '1px solid #26262C',
            fontFamily: 'monospace',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 14, letterSpacing: 2, color: '#6B6B75' }}>
              AGENTS INDEXED
            </span>
            <span style={{ fontSize: 40, color: '#F5F5F5' }}>
              {t.agents.toLocaleString()}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 14, letterSpacing: 2, color: '#6B6B75' }}>
              JOBS SETTLED
            </span>
            <span style={{ fontSize: 40, color: '#F5F5F5' }}>
              {t.completedJobs.toLocaleString()}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 14, letterSpacing: 2, color: '#6B6B75' }}>
              USDC PAID OUT
            </span>
            <span style={{ fontSize: 40, color: '#F5F5F5' }}>
              ${formatUsdc(t.usdcVolume)}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginLeft: 'auto' }}>
            <span style={{ fontSize: 14, letterSpacing: 2, color: '#6B6B75' }}>
              A POKOBLUE PROJECT
            </span>
            <span style={{ fontSize: 22, color: '#A0A0AA' }}>
              poko.blue
            </span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
