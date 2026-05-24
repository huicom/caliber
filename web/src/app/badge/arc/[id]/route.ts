// Server-rendered SVG Caliber badge. Designed for the embed.js script to
// inject onto an agent's own website. ~180x56 px, tier-colored, monospace
// type, no external font loads (uses ui-monospace fallback chain so it
// renders consistently regardless of the host page's typography).
//
// URL:  /badge/arc/{agentId}  →  image/svg+xml
//
// Always returns 200 with a placeholder badge if the agent has no rating
// yet — failing to a 404 here would break the agent's website silently.
//
// Cached 5 min at the edge; agents who care about freshness can append a
// versioned query string (?v=...) which the route accepts and ignores.

import { db, agents, ratingSnapshots } from '@/lib/db';
import { eq, and, desc } from 'drizzle-orm';
import type { CaliberTier } from '@/lib/api';

// v2.0.1 metallurgical tier palette — must mirror --tier-* tokens in globals.css.
const TIER_COLORS: Record<CaliberTier, { border: string; bg: string; text: string }> = {
  Gold:    { border: '#B8862B', bg: '#FBF5EC', text: '#B8862B' },
  Silver:  { border: '#7E8690', bg: '#F0F1F3', text: '#7E8690' },
  Bronze:  { border: '#8C5A2C', bg: '#F8F0E8', text: '#8C5A2C' },
  Pending: { border: '#98948C', bg: '#F4F2EE', text: '#98948C' },
  Watch:   { border: '#B45309', bg: '#FCF1E6', text: '#B45309' },
  Dormant: { border: '#A8A39A', bg: '#F4F2EE', text: '#A8A39A' },
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildBadge(opts: {
  tier: CaliberTier | null;
  name: string;
  agentId: string;
}): string {
  const W = 200;
  const H = 56;
  const colors = opts.tier ? TIER_COLORS[opts.tier] : TIER_COLORS.Pending;
  const tierLabel = opts.tier ?? 'UNRATED';
  const subline = `agent #${opts.agentId} · caliber v2.0.1`;
  // Truncate display name to a width that fits the badge — ~16 chars max
  const safeName = opts.name.length > 18 ? opts.name.slice(0, 17) + '…' : opts.name;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Caliber rating: ${escapeXml(tierLabel)}">
  <style>
    .stage { font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace; }
    .tier { font-weight: 600; letter-spacing: 0.04em; font-size: 13px; fill: ${colors.text}; }
    .name { font-weight: 500; font-size: 11px; fill: ${colors.text}; }
    .sub  { font-size: 8.5px; fill: ${colors.text}; opacity: 0.7; letter-spacing: 0.04em; }
    .mark { fill: none; stroke: ${colors.text}; stroke-width: 1; }
    .dot  { fill: ${colors.border}; }
  </style>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="4" fill="${colors.bg}" stroke="${colors.border}" stroke-width="1" />
  <!-- aperture mark, mirrors the site logo -->
  <g class="stage" transform="translate(14, 16)">
    <circle cx="12" cy="12" r="10.5" class="mark"/>
    <circle cx="12" cy="12" r="6.5"  class="mark"/>
    <circle cx="12" cy="12" r="2.5"  class="mark"/>
    <circle cx="20" cy="12" r="1.4"  class="dot"/>
  </g>
  <text x="44" y="22" class="stage tier">${escapeXml(tierLabel)}</text>
  <text x="44" y="36" class="stage name">${escapeXml(safeName)}</text>
  <text x="44" y="48" class="stage sub">${escapeXml(subline)}</text>
</svg>`;
}

export const dynamic = 'force-dynamic'; // route reads the live DB; cache headers do the caching

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return new Response('bad agent id', { status: 400 });
  }
  const agentId = BigInt(id);

  const [agent, snapshotRows] = await Promise.all([
    db.select().from(agents).where(eq(agents.agentId, agentId)).limit(1).then((r) => r[0]),
    db
      .select()
      .from(ratingSnapshots)
      .where(and(eq(ratingSnapshots.agentId, agentId), eq(ratingSnapshots.view, 'PIT')))
      .orderBy(desc(ratingSnapshots.computedAt))
      .limit(1),
  ]);

  const tier = (snapshotRows[0]?.tier as CaliberTier | undefined) ?? null;
  const name = agent?.name ?? `Agent #${id}`;
  const svg = buildBadge({ tier, name, agentId: id });

  return new Response(svg, {
    status: 200,
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=300',
      // Allow embedding from any origin (the whole point of the badge).
      'access-control-allow-origin': '*',
    },
  });
}
