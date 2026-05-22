import Link from 'next/link';
import { db } from '@/lib/db';
import { sql as drizzleSql } from 'drizzle-orm';
import type { CaliberTier } from '@/lib/api';

const PAGE_DESCRIPTION =
  'Track 3 of Caliber Phase 2: a live feed of agent tier movements and flag firings on Arc Testnet. Caliber-rated agents that move up, move down, enter Watch/Inactive, or trigger a risk flag show up here.';

export const metadata = {
  title: 'Watchlist — Caliber tier transitions',
  description: PAGE_DESCRIPTION,
  openGraph: {
    title: 'Watchlist — Caliber tier transitions',
    description: PAGE_DESCRIPTION,
    url: 'https://caliber.poko.blue/watchlist',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Watchlist — Caliber tier transitions',
    description: PAGE_DESCRIPTION,
  },
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const FLAG_NAMES = [
  'CounterpartyConcentration',
  'ValidatorConcentration',
  'SybilPattern',
  'VolumeAnomaly',
  'Dormancy',
];

const TIER_COLOR: Record<CaliberTier, string> = {
  Established: '#00B894',
  Proven:      '#0EA5E9',
  Emerging:    '#14B8A6',
  Provisional: '#94A3B8',
  Watch:       '#F59E0B',
  Inactive:    '#1F2937',
};

const KIND_LABELS: Record<string, { verb: string; icon: string; tone: 'good' | 'bad' | 'neutral' }> = {
  first_rating:   { verb: 'received first rating', icon: '✦', tone: 'neutral' },
  tier_up:        { verb: 'moved up to',           icon: '↑', tone: 'good' },
  tier_down:      { verb: 'moved down to',         icon: '↓', tone: 'bad' },
  enter_watch:    { verb: 'entered Watch',         icon: '⚠', tone: 'bad' },
  enter_inactive: { verb: 'went Inactive',         icon: '◌', tone: 'bad' },
  exit_watch:     { verb: 'left Watch',            icon: '↻', tone: 'good' },
  exit_inactive:  { verb: 'reactivated',           icon: '↻', tone: 'good' },
  flag_added:     { verb: 'gained a risk flag',    icon: '⚐', tone: 'bad' },
  flag_removed:   { verb: 'cleared a risk flag',   icon: '✓', tone: 'good' },
};

function flagsToNames(mask: number | null): string[] {
  if (mask == null) return [];
  return FLAG_NAMES.filter((_, i) => (mask & (1 << i)) !== 0);
}

function relativeTime(date: Date): string {
  const ms = Date.now() - date.getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) {
    const hrs = Math.floor(ms / 3_600_000);
    if (hrs < 1) return 'just now';
    return `${hrs}h ago`;
  }
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

interface TransitionRow {
  id: string;
  chain_id: string;
  agent_id: string;
  agent_name: string | null;
  agent_jobs_completed: number | null;
  at: Date;
  kind: string;
  from_tier: string | null;
  to_tier: string;
  from_flags: number | null;
  to_flags: number;
  to_score: number | null;
  methodology_version: string;
}

async function loadFeed(filter?: string): Promise<TransitionRow[]> {
  const allowed = new Set(Object.keys(KIND_LABELS));
  const kinds = (filter ? filter.split(',') : []).filter((k) => allowed.has(k));
  const where =
    kinds.length > 0
      ? `WHERE t.kind IN (${kinds.map((k) => `'${k}'`).join(',')})`
      : '';
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
      t.to_score                                       AS to_score,
      t.methodology_version                            AS methodology_version,
      a.name                                           AS agent_name,
      a.jobs_completed                                 AS agent_jobs_completed
    FROM tier_transitions t
    LEFT JOIN agents a ON a.agent_id = t.agent_id
    ${where}
    ORDER BY t.at DESC, t.id DESC
    LIMIT 100;
  `));
  return (rows.rows ?? rows) as TransitionRow[];
}

export default async function WatchlistPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind } = await searchParams;
  const events = await loadFeed(kind);

  const KIND_FILTERS = [
    { label: 'all', value: '', hint: 'every event' },
    { label: 'tier down', value: 'tier_down,enter_watch,enter_inactive', hint: 'agents that dropped' },
    { label: 'tier up', value: 'tier_up,exit_watch,exit_inactive', hint: 'agents that climbed' },
    { label: 'flags', value: 'flag_added,flag_removed', hint: 'risk flag changes' },
    { label: 'new ratings', value: 'first_rating', hint: 'first time on the board' },
  ];
  const activeKind = kind ?? '';

  return (
    <main className="mx-auto max-w-3xl px-4 sm:px-5 py-10 sm:py-14 space-y-8">
      <section>
        <nav className="font-mono text-[11px] text-[var(--color-mute)] mb-4">
          <Link href="/" className="hover:text-[var(--color-copper)]">caliber</Link>
          <span className="mx-2 opacity-50">/</span>
          <span>watchlist</span>
        </nav>
        <h1 className="text-3xl sm:text-4xl font-semibold text-[var(--color-ink)] tracking-tight mb-3">
          Watchlist
        </h1>
        <p className="text-[15px] text-[var(--color-ink)] leading-relaxed max-w-prose">
          A live feed of tier movements and risk-flag firings across Caliber-rated agents on Arc.
          When an agent moves up, drops down, enters Watch, or trips a flag — it lands here. Use as
          an alarm clock for the agents you depend on.
        </p>
        <p className="text-sm text-[var(--color-mute)] mt-3">
          Subscribe:{' '}
          <Link href="/watchlist/subscribe" className="text-[var(--color-copper)] hover:underline">
            via Discord →
          </Link>{' '}
          ·{' '}
          <Link href="/watchlist.rss" className="text-[var(--color-copper)] hover:underline font-mono text-xs">
            RSS
          </Link>{' '}
          ·{' '}
          <Link href="/api/watchlist" className="text-[var(--color-copper)] hover:underline font-mono text-xs">
            /api/watchlist
          </Link>
        </p>
      </section>

      {/* Filter chips */}
      <nav className="flex flex-wrap gap-2 -mt-2">
        {KIND_FILTERS.map((f) => {
          const isActive = activeKind === f.value;
          const href = f.value ? `/watchlist?kind=${encodeURIComponent(f.value)}` : '/watchlist';
          return (
            <Link
              key={f.label}
              href={href}
              title={f.hint}
              className={
                'font-mono text-xs px-3 py-1.5 rounded-[2px] border transition ' +
                (isActive
                  ? 'border-[var(--color-copper)] text-[var(--color-copper)] bg-[var(--color-bg-elev)]'
                  : 'border-[var(--color-hairline)] text-[var(--color-mute)] hover:border-[var(--color-ink)] hover:text-[var(--color-ink)]')
              }
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      {/* Feed */}
      <section className="space-y-2">
        {events.length === 0 ? (
          <div className="border border-[var(--color-hairline)] bg-white rounded-[2px] p-6 text-center">
            <p className="text-sm text-[var(--color-ink)]">No events matching that filter yet.</p>
            <p className="text-xs text-[var(--color-mute)] mt-2">
              The daily snapshot runs at 04:00 UTC. Check back tomorrow, or{' '}
              <Link href="/watchlist" className="text-[var(--color-copper)] hover:underline">
                clear the filter
              </Link>
              .
            </p>
          </div>
        ) : (
          events.map((e) => {
            const meta = KIND_LABELS[e.kind] ?? { verb: e.kind, icon: '·', tone: 'neutral' as const };
            const at = e.at instanceof Date ? e.at : new Date(e.at);
            const flagsAdded = flagsToNames(e.to_flags & ~(e.from_flags ?? 0));
            const flagsRemoved = flagsToNames((e.from_flags ?? 0) & ~e.to_flags);
            const displayName = e.agent_name ?? `Agent #${e.agent_id}`;
            const toneColor =
              meta.tone === 'bad'
                ? 'text-[#B45309]'
                : meta.tone === 'good'
                  ? 'text-[#047857]'
                  : 'text-[var(--color-mute)]';
            return (
              <article
                key={e.id}
                className="border border-[var(--color-hairline)] bg-white rounded-[2px] px-4 py-3 hover:bg-[var(--color-bg-elev)] transition"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[var(--color-ink)] leading-snug">
                      <span className={'font-mono text-base mr-1.5 ' + toneColor}>{meta.icon}</span>
                      <Link
                        href={`/passport/${e.chain_id}/${e.agent_id}`}
                        className="font-medium hover:text-[var(--color-copper)] transition"
                      >
                        {displayName}
                      </Link>{' '}
                      <span className="text-[var(--color-mute)]">{meta.verb}</span>{' '}
                      <span
                        style={{
                          color: TIER_COLOR[e.to_tier as CaliberTier] ?? 'var(--color-ink)',
                        }}
                        className="font-mono text-sm font-semibold"
                      >
                        {e.to_tier}
                      </span>
                      {e.from_tier && e.kind === 'tier_down' && (
                        <span className="text-xs text-[var(--color-mute)] ml-1">(from {e.from_tier})</span>
                      )}
                      {e.from_tier && e.kind === 'tier_up' && (
                        <span className="text-xs text-[var(--color-mute)] ml-1">(from {e.from_tier})</span>
                      )}
                    </p>
                    {(flagsAdded.length > 0 || flagsRemoved.length > 0) && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {flagsAdded.map((f) => (
                          <span
                            key={'+' + f}
                            className="font-mono text-[10px] px-1.5 py-0.5 border border-[#F59E0B]/40 bg-[#FEF3E2] text-[#B45309] rounded-[2px]"
                          >
                            +{f}
                          </span>
                        ))}
                        {flagsRemoved.map((f) => (
                          <span
                            key={'-' + f}
                            className="font-mono text-[10px] px-1.5 py-0.5 border border-[#00B894]/40 bg-[#E6F7F2] text-[#047857] rounded-[2px]"
                          >
                            −{f}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="font-mono text-[10px] text-[var(--color-mute)] mt-1.5">
                      #{e.agent_id} ·{' '}
                      {e.agent_jobs_completed != null ? `${e.agent_jobs_completed} jobs · ` : ''}
                      methodology v{e.methodology_version}
                    </p>
                  </div>
                  <span className="font-mono text-[11px] text-[var(--color-mute)] shrink-0 whitespace-nowrap">
                    {relativeTime(at)}
                  </span>
                </div>
              </article>
            );
          })
        )}
      </section>

      <section className="border-t border-[var(--color-hairline)] pt-6 text-sm text-[var(--color-mute)] leading-relaxed">
        <p>
          Transitions are computed by the daily snapshot cron from diffs against the previous day&rsquo;s
          Caliber rating. First-rating events appear on the day Caliber first publishes a rating for an
          agent. Methodology and code:{' '}
          <Link href="/methodology" className="text-[var(--color-copper)] hover:underline">
            /methodology
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
