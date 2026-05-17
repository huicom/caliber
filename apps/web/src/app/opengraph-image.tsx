import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';
export const contentType = 'image/png';
export const size = { width: 1200, height: 630 };

export default async function Image() {
  let agentCount = 0;
  try {
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
    const res = await fetch(`${base}/api/stats`, { next: { revalidate: 60 } });
    const json = await res.json();
    agentCount = json?.totals?.agents ?? 0;
  } catch {
    // use 0
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          background: 'linear-gradient(135deg, #0B0D14 0%, #1F1F3A 100%)',
          color: '#E6E8EE',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 12,
              background: 'linear-gradient(135deg, #5B5BD6, #7c3aed)',
            }}
          />
          <h1 style={{ fontSize: 64, fontWeight: 700, margin: 0 }}>
            ArcAgents
          </h1>
        </div>
        <p
          style={{
            fontSize: 32,
            color: '#9095A6',
            margin: 0,
            marginBottom: 32,
            maxWidth: 800,
            textAlign: 'center',
          }}
        >
          The first agent explorer for Arc — browse every ERC-8004 AI agent
        </p>
        <div
          style={{
            display: 'flex',
            gap: 40,
            fontSize: 24,
            color: '#5B5BD6',
            fontWeight: 600,
          }}
        >
          <span>{agentCount.toLocaleString()} Agents</span>
          <span>Testnet Live</span>
          <span>Bangkok 🇹🇭</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
