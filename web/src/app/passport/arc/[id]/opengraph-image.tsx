// Track 1.4: per-Passport OG share-card. 1200×630 tier-colored card
// rendered server-side by next/og. Renders when someone pastes a Passport
// URL into Twitter/Discord/LinkedIn/Slack — sized to fit any of those
// preview cards.

import { ImageResponse } from 'next/og';
import { db, agents, ratingSnapshots } from '@/lib/db';
import { eq, and, desc } from 'drizzle-orm';

export const runtime = 'nodejs';
export const contentType = 'image/png';
export const size = { width: 1200, height: 630 };
export const alt = 'Caliber Passport';

interface TierVisuals {
  border: string;
  text: string;
  bg: string;
  wash: string;
}

// v2.0.1 metallurgical tier palette — must mirror the --tier-* tokens in globals.css.
const TIER_COLORS: Record<string, TierVisuals> = {
  Gold:    { border: '#B8862B', text: '#D4A04A', bg: '#0F0C07', wash: 'rgba(184,134,43,0.20)' },
  Silver:  { border: '#7E8690', text: '#A8AFB7', bg: '#0B0D10', wash: 'rgba(126,134,144,0.20)' },
  Bronze:  { border: '#8C5A2C', text: '#B8804D', bg: '#0E0A07', wash: 'rgba(140,90,44,0.20)' },
  Pending: { border: '#98948C', text: '#B8B4AB', bg: '#0C0C0B', wash: 'rgba(152,148,140,0.18)' },
  Watch:   { border: '#B45309', text: '#D67A2A', bg: '#100B07', wash: 'rgba(180,83,9,0.22)' },
  Dormant: { border: '#A8A39A', text: '#A8A39A', bg: '#0A0A09', wash: 'rgba(168,163,154,0.15)' },
};

const RATING_API_BASE =
  process.env.NEXT_PUBLIC_RATING_API_BASE ?? 'https://caliber-api.poko.blue';

async function fetchLiveRating(id: string): Promise<{ score?: number; flags?: number } | null> {
  try {
    const res = await fetch(`${RATING_API_BASE}/v1/agents/arc/${id}/rating`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const j = await res.json();
    return { score: j.score, flags: (j.flags ?? []).length };
  } catch {
    return null;
  }
}

export default async function PassportOG({ params }: { params: { id: string } }) {
  const { id } = params;
  if (!/^\d+$/.test(id)) {
    return new ImageResponse(<FallbackCard message="Caliber Passport" />, { ...size });
  }
  const agentId = BigInt(id);

  const [[agent], snapshotRows, live] = await Promise.all([
    db.select().from(agents).where(eq(agents.agentId, agentId)).limit(1),
    db
      .select()
      .from(ratingSnapshots)
      .where(and(eq(ratingSnapshots.agentId, agentId), eq(ratingSnapshots.view, 'PIT')))
      .orderBy(desc(ratingSnapshots.computedAt))
      .limit(1),
    fetchLiveRating(id),
  ]);

  if (!agent) {
    return new ImageResponse(<FallbackCard message={`Agent #${id} · Caliber`} />, { ...size });
  }

  const tier = snapshotRows[0]?.tier ?? null;
  const visuals = TIER_COLORS[tier ?? 'Pending'] ?? TIER_COLORS.Pending;
  const name = agent.name ?? `Agent #${id}`;
  const description = ((agent.metadata as any)?.description as string | undefined) ?? '';
  const score = live?.score ?? null;
  const flagCount = live?.flags ?? 0;
  const interactionCount = snapshotRows[0]?.interactionCount ?? 0;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: visuals.bg,
          color: '#F5F5F5',
          padding: '64px 72px',
          fontFamily: 'system-ui, sans-serif',
          position: 'relative',
        }}
      >
        {/* Tier-color wash band across the top */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 8,
            background: visuals.border,
            display: 'flex',
          }}
        />

        {/* Eyebrow: caliber + chain */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            fontFamily: 'monospace',
            fontSize: 18,
            letterSpacing: 3,
            color: '#9CA3AF',
            marginBottom: 30,
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10.5" stroke="#9CA3AF" strokeWidth="1" fill="none" />
            <circle cx="12" cy="12" r="6.5" stroke="#9CA3AF" strokeWidth="1" fill="none" />
            <circle cx="12" cy="12" r="2.5" stroke="#9CA3AF" strokeWidth="1" fill="none" />
            <circle cx="20" cy="12" r="1.4" fill="#C2410C" />
          </svg>
          <span>CALIBER · ARC TESTNET · PASSPORT</span>
        </div>

        {/* Agent name */}
        <div
          style={{
            fontSize: 76,
            fontWeight: 600,
            letterSpacing: '-0.025em',
            lineHeight: 1.05,
            marginBottom: 14,
            display: 'flex',
            maxWidth: '90%',
          }}
        >
          {name.length > 32 ? name.slice(0, 31) + '…' : name}
        </div>

        {/* Description */}
        {description && (
          <div
            style={{
              fontSize: 24,
              color: '#9CA3AF',
              lineHeight: 1.35,
              marginBottom: 36,
              display: 'flex',
              maxWidth: '88%',
            }}
          >
            {description.length > 160 ? description.slice(0, 159) + '…' : description}
          </div>
        )}

        {/* Tier + score band */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 32,
            marginTop: 'auto',
            paddingTop: 28,
            borderTop: `1px solid ${visuals.border}55`,
          }}
        >
          {/* Tier badge */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: '14px 24px',
              borderRadius: 6,
              border: `2px solid ${visuals.border}`,
              background: visuals.wash,
            }}
          >
            <span
              style={{
                fontSize: 13,
                letterSpacing: 4,
                color: '#9CA3AF',
                textTransform: 'uppercase',
                fontFamily: 'monospace',
              }}
            >
              tier
            </span>
            <span
              style={{
                fontSize: 44,
                fontWeight: 600,
                color: visuals.border,
                letterSpacing: '-0.02em',
              }}
            >
              {tier ?? 'Unrated'}
            </span>
          </div>

          {/* Score */}
          {score !== null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span
                style={{
                  fontSize: 13,
                  letterSpacing: 4,
                  color: '#9CA3AF',
                  fontFamily: 'monospace',
                  textTransform: 'uppercase',
                }}
              >
                score
              </span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontFamily: 'monospace' }}>
                <span style={{ fontSize: 56, fontWeight: 600, color: '#F5F5F5' }}>{score}</span>
                <span style={{ fontSize: 24, color: '#6B7280' }}>/ 100</span>
              </div>
            </div>
          )}

          {/* Interactions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span
              style={{
                fontSize: 13,
                letterSpacing: 4,
                color: '#9CA3AF',
                fontFamily: 'monospace',
                textTransform: 'uppercase',
              }}
            >
              interactions
            </span>
            <span style={{ fontSize: 36, fontFamily: 'monospace', color: '#F5F5F5' }}>
              {interactionCount.toLocaleString()}
            </span>
          </div>

          {/* Flags */}
          {flagCount > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span
                style={{
                  fontSize: 13,
                  letterSpacing: 4,
                  color: '#F59E0B',
                  fontFamily: 'monospace',
                  textTransform: 'uppercase',
                }}
              >
                risk flags
              </span>
              <span style={{ fontSize: 36, fontFamily: 'monospace', color: '#F59E0B' }}>
                {flagCount}
              </span>
            </div>
          )}

          {/* Right-aligned: chain + methodology */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              marginLeft: 'auto',
              alignItems: 'flex-end',
              fontFamily: 'monospace',
              color: '#6B7280',
            }}
          >
            <span style={{ fontSize: 13, letterSpacing: 3 }}>METHODOLOGY V2.0</span>
            <span style={{ fontSize: 13, letterSpacing: 3 }}>CALIBER.POKO.BLUE</span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}

function FallbackCard({ message }: { message: string }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0A0A0B',
        color: '#F5F5F5',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 48,
      }}
    >
      {message}
    </div>
  );
}
