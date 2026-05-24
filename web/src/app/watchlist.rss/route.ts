// RSS 2.0 feed for the Caliber watchlist. Subscribable in any feed reader.
//
// Cache 5 min — daily snapshot fires once at 04:00 UTC, so 5min is plenty
// fresh for downstream readers.

import { db } from '@/lib/db';
import { sql as drizzleSql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const SITE = 'https://caliber.poko.blue';

const FLAG_NAMES = [
  'CounterpartyConcentration',
  'ValidatorConcentration',
  'SybilPattern',
  'VolumeAnomaly',
  'Dormancy',
];

const KIND_VERB: Record<string, string> = {
  first_rating: 'received first Caliber rating',
  tier_up: 'moved up to',
  tier_down: 'moved down to',
  enter_watch: 'entered Watch tier',
  enter_dormant: 'went Dormant',
  exit_watch: 'left Watch tier',
  exit_dormant: 'reactivated to',
  flag_added: 'gained risk flag while at',
  flag_removed: 'cleared risk flag while at',
};

function flagsToNames(mask: number | null): string[] {
  if (mask == null) return [];
  return FLAG_NAMES.filter((_, i) => (mask & (1 << i)) !== 0);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET() {
  const rows: any = await db.execute(drizzleSql.raw(`
    SELECT
      t.id::text                                       AS id,
      t.chain_id                                       AS chain_id,
      t.agent_id::text                                 AS agent_id,
      t.at                                             AS at,
      t.kind                                           AS kind,
      t.from_tier                                      AS from_tier,
      t.to_tier                                        AS to_tier,
      t.from_flags                                     AS from_flags,
      t.to_flags                                       AS to_flags,
      t.methodology_version                            AS methodology_version,
      a.name                                           AS agent_name
    FROM tier_transitions t
    LEFT JOIN agents a ON a.agent_id = t.agent_id
    ORDER BY t.at DESC, t.id DESC
    LIMIT 50;
  `));
  const events = (rows.rows ?? rows) as Array<any>;

  const lastBuildDate = events[0]?.at
    ? (events[0].at instanceof Date ? events[0].at : new Date(events[0].at)).toUTCString()
    : new Date().toUTCString();

  const items = events
    .map((e) => {
      const at = e.at instanceof Date ? e.at : new Date(e.at);
      const name = e.agent_name ?? `Agent #${e.agent_id}`;
      const verb = KIND_VERB[e.kind] ?? e.kind;
      const title = `${name} ${verb} ${e.to_tier}`;
      const flagsAdded = flagsToNames(e.to_flags & ~(e.from_flags ?? 0));
      const flagsRemoved = flagsToNames((e.from_flags ?? 0) & ~e.to_flags);
      const detailLines = [
        e.from_tier ? `Previous tier: ${e.from_tier}` : null,
        `Current tier: ${e.to_tier}`,
        flagsAdded.length ? `Flags added: ${flagsAdded.join(', ')}` : null,
        flagsRemoved.length ? `Flags removed: ${flagsRemoved.join(', ')}` : null,
        `Methodology version: ${e.methodology_version}`,
      ].filter(Boolean);
      const link = `${SITE}/passport/${e.chain_id}/${e.agent_id}`;
      return `    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="false">caliber-${e.id}</guid>
      <pubDate>${at.toUTCString()}</pubDate>
      <description>${escapeXml(detailLines.join(' · '))}</description>
      <category>${escapeXml(e.kind)}</category>
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Caliber Watchlist</title>
    <link>${SITE}/watchlist</link>
    <description>Tier movements and risk-flag firings across Caliber-rated agents on Arc Testnet.</description>
    <language>en</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link xmlns:atom="http://www.w3.org/2005/Atom" href="${SITE}/watchlist.rss" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=300',
    },
  });
}
