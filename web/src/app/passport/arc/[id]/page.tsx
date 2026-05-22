import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db, agents, ratingSnapshots } from '@/lib/db';
import { eq, and, desc } from 'drizzle-orm';
import { AgentAvatar } from '@/components/ui/AgentAvatar';
import { RatingBadge } from '@/components/ui/RatingBadge';
import { formatUSDC, arcscanTxUrl } from '@/lib/format';
import {
  type CaliberTier,
  type ConfidenceLabel,
  type RatingFlag,
} from '@/lib/api';
import { RatingTrajectoryChart } from '@/app/agents/[id]/_components/RatingTrajectoryChart';
import { PassportActions } from './_components/PassportActions';
import {
  TIER_EXPLAINERS,
  FLAG_EXPLAINERS,
  CONFIDENCE_EXPLAINERS,
} from './_components/tier-explainer';

const RATING_API_BASE =
  process.env.NEXT_PUBLIC_RATING_API_BASE ?? 'https://caliber-api.poko.blue';

// Caliber issues attestations. The Passport is the human-readable face of
// that attestation — designed to be shared, embedded, and read in 60 seconds
// by someone who's never opened a block explorer.
//
// Inputs:
//   - agents table:        canonical identity, name, description, capabilities
//   - rating_snapshots:    daily PIT snapshot (tier, completion, escrow, ...)
//   - rating service API:  current tier+score+confidence+flags (live, source-of-truth)
//
// The page degrades gracefully when the rating service is unreachable: the
// snapshot's tier still renders, just without a score and live flag list.

interface LiveRating {
  rated: boolean;
  tier?: CaliberTier;
  score?: number;
  confidence?: ConfidenceLabel;
  confidence_label?: string;
  flags?: RatingFlag[];
  interaction_count?: number;
  methodology_version?: string;
  computed_at?: string;
  reason?: string;
}

async function fetchLiveRating(chain: string, id: string): Promise<LiveRating | null> {
  try {
    const res = await fetch(
      `${RATING_API_BASE}/v1/agents/${chain}/${id}/rating`,
      { next: { revalidate: 60 } },
    );
    if (!res.ok) return null;
    return (await res.json()) as LiveRating;
  } catch {
    return null;
  }
}

function relativeTime(date: Date | null): string {
  if (!date) return '—';
  const ms = Date.now() - date.getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const agentId = BigInt(id);
  const [agent] = await db.select().from(agents).where(eq(agents.agentId, agentId)).limit(1);
  if (!agent) {
    return { title: 'Caliber Passport — not found' };
  }
  const name = agent.name ?? `Agent #${id}`;
  const description =
    ((agent.metadata as any)?.description as string | undefined)?.slice(0, 140) ??
    `A Caliber-rated ERC-8004 agent on Arc Testnet. Trust signal, signed and verifiable.`;
  return {
    title: `${name} · Caliber Passport`,
    description,
    openGraph: {
      title: `${name} — Caliber Passport`,
      description,
      url: `https://caliber.poko.blue/passport/arc/${id}`,
      type: 'profile',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${name} — Caliber Passport`,
      description,
    },
  };
}

export default async function PassportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return notFound();
  const agentId = BigInt(id);

  const [[agent], snapshotRows, live] = await Promise.all([
    db.select().from(agents).where(eq(agents.agentId, agentId)).limit(1),
    db
      .select()
      .from(ratingSnapshots)
      .where(and(eq(ratingSnapshots.agentId, agentId), eq(ratingSnapshots.view, 'PIT')))
      .orderBy(desc(ratingSnapshots.computedAt))
      .limit(1),
    fetchLiveRating('arc', id),
  ]);

  if (!agent) return notFound();
  const snapshot = snapshotRows[0] ?? null;

  // Prefer live rating (fresh) over snapshot (cached daily).
  const tier: CaliberTier | null =
    (live?.tier as CaliberTier | undefined) ?? (snapshot?.tier as CaliberTier | undefined) ?? null;
  const score = live?.score ?? null;
  const confidence: ConfidenceLabel | null =
    (live?.confidence as ConfidenceLabel | undefined) ??
    (snapshot?.confidence as ConfidenceLabel | undefined) ??
    null;
  const flags = live?.flags ?? [];
  const interactionCount =
    live?.interaction_count ?? snapshot?.interactionCount ?? 0;
  const completion = snapshot?.ppd30d ? Number(snapshot.ppd30d) : null;
  const forward = snapshot?.lgd ? Number(snapshot.lgd) : null;
  const activeEscrow = snapshot?.eadUsdc ?? null;
  const description = (agent.metadata as any)?.description as string | undefined;

  const name = agent.name ?? `Agent #${id}`;
  const passportUrl = `https://caliber.poko.blue/passport/arc/${id}`;
  const explainer = tier ? TIER_EXPLAINERS[tier] : null;
  const unrated = live?.rated === false || !tier;

  return (
    <main className="mx-auto max-w-3xl px-4 sm:px-5 py-8 sm:py-12 space-y-10">
      {/* Crumb */}
      <nav className="font-mono text-[11px] text-[var(--color-mute)] -mb-4">
        <Link href="/discover" className="hover:text-[var(--color-copper)]">discover</Link>
        <span className="mx-2 opacity-50">/</span>
        <span>passport</span>
      </nav>

      {/* Hero: avatar + name + description + tier + score + confidence */}
      <section className="border border-[var(--color-hairline)] bg-white rounded-[2px] p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row gap-5 sm:gap-7 items-start">
          <AgentAvatar id={String(agent.agentId)} size={88} />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-3 flex-wrap mb-1">
              <h1 className="text-2xl sm:text-3xl font-semibold text-[var(--color-ink)] tracking-tight">
                {name}
              </h1>
              <span className="font-mono text-xs text-[var(--color-mute)]">#{id}</span>
            </div>
            {description ? (
              <p className="text-[15px] text-[var(--color-ink)] leading-snug max-w-prose">
                {description.slice(0, 220)}
                {description.length > 220 ? '…' : ''}
              </p>
            ) : (
              <p className="text-sm italic text-[var(--color-mute)]">No description published by this agent.</p>
            )}
          </div>
        </div>

        {/* Tier + score band */}
        <div className="mt-6 pt-5 border-t border-[var(--color-hairline)] flex flex-wrap items-center gap-4 sm:gap-6">
          {tier ? (
            <RatingBadge tier={tier} rated size="md" />
          ) : (
            <RatingBadge rated={false} reason={live?.reason ?? 'insufficient data'} size="md" />
          )}
          {score !== null && (
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-3xl text-[var(--color-ink)] tabular-nums">{score}</span>
              <span className="font-mono text-xs text-[var(--color-mute)]">/ 100</span>
            </div>
          )}
          {confidence && (
            <span className="font-mono text-xs uppercase tracking-[0.05em] text-[var(--color-mute)]">
              {confidence === 'insufficient' ? 'insufficient data' : `${confidence} confidence`}
            </span>
          )}
          {interactionCount > 0 && (
            <span className="font-mono text-xs text-[var(--color-mute)]">
              · {interactionCount} interactions
            </span>
          )}
        </div>
      </section>

      {/* "What this means" plain-English explainer */}
      {!unrated && explainer && (
        <section>
          <h2 className="font-mono text-[13px] text-[var(--color-ink)] tracking-[0.02em] mb-3">
            //what_this_means
          </h2>
          <div className="border-l-2 border-[var(--color-copper)] pl-5 py-1 space-y-2">
            <p className="text-base text-[var(--color-ink)] font-medium leading-snug">{explainer.headline}</p>
            <p className="text-[15px] text-[var(--color-ink)] leading-relaxed">{explainer.body}</p>
            {confidence && (
              <p className="text-sm text-[var(--color-mute)] leading-relaxed">
                {CONFIDENCE_EXPLAINERS[confidence]}
              </p>
            )}
          </div>

          {flags.length > 0 && (
            <div className="mt-5 space-y-2">
              <p className="font-mono text-[11px] text-[var(--color-mute)] uppercase tracking-[0.08em]">
                risk flags triggered
              </p>
              {flags.map((flag) => (
                <div
                  key={flag}
                  className="border border-[#F59E0B]/40 bg-[#F59E0B]/8 rounded-[2px] px-3 py-2"
                >
                  <p className="font-mono text-xs text-[#B45309] mb-0.5">{flag}</p>
                  <p className="text-sm text-[var(--color-ink)] leading-snug">{FLAG_EXPLAINERS[flag]}</p>
                </div>
              ))}
            </div>
          )}

          <p className="text-sm text-[var(--color-mute)] mt-4">
            <Link href="/methodology" className="text-[var(--color-copper)] hover:underline">
              how is this calculated? →
            </Link>
          </p>
        </section>
      )}

      {unrated && (
        <section>
          <h2 className="font-mono text-[13px] text-[var(--color-ink)] tracking-[0.02em] mb-3">
            //unrated
          </h2>
          <p className="text-[15px] text-[var(--color-ink)] leading-relaxed">
            Caliber doesn&rsquo;t publish a rating for this agent yet.{' '}
            {live?.reason === 'insufficient_interactions'
              ? 'Fewer than 5 interactions on-chain — too thin to draw conclusions.'
              : live?.reason === 'insufficient_history'
                ? 'Registered too recently — Caliber waits 14 days before issuing a first rating.'
                : 'The next daily snapshot may add one.'}{' '}
            <Link href="/methodology" className="text-[var(--color-copper)] hover:underline">
              read the methodology →
            </Link>
          </p>
        </section>
      )}

      {/* Trust-signals-at-a-glance strip */}
      <section className="space-y-3">
        <h2 className="font-mono text-[13px] text-[var(--color-ink)] tracking-[0.02em]">
          //trust_signals
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <SignalCell label="completion" value={completion !== null ? `${(completion * 100).toFixed(0)}%` : '—'} hint="recent jobs that finished successfully" />
          <SignalCell label="jobs completed" value={String(agent.jobsCompleted ?? 0)} hint="lifetime, on-chain" />
          <SignalCell label="active escrow" value={formatEscrow(activeEscrow)} hint="USDC currently locked for in-flight jobs" />
          <SignalCell label="last active" value={relativeTime(agent.updatedAt)} hint="most recent on-chain event" />
        </div>
      </section>

      {/* Trajectory chart — reused from existing /agents page */}
      {snapshot && (
        <section className="space-y-3">
          <h2 className="font-mono text-[13px] text-[var(--color-ink)] tracking-[0.02em]">
            //rating_over_time
          </h2>
          <RatingTrajectoryChart chain="arc" agentId={id} />
        </section>
      )}

      {/* Actions: download attestation, verify, copy embed */}
      <PassportActions chain="arc" agentId={id} agentName={name} passportUrl={passportUrl} />

      {/* Technical footer — kept compact and at the bottom */}
      <section className="space-y-3 pt-2">
        <h2 className="font-mono text-[13px] text-[var(--color-ink)] tracking-[0.02em]">
          //technical_details
        </h2>
        <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="font-mono text-xs text-[var(--color-mute)]">owner</dt>
          <dd className="font-mono text-xs text-[var(--color-ink)] break-all">{agent.ownerAddress}</dd>
          <dt className="font-mono text-xs text-[var(--color-mute)]">registered</dt>
          <dd className="font-mono text-xs text-[var(--color-ink)]">
            block {String(agent.registeredAtBlock)}{' '}
            {agent.registeredAt && `· ${new Date(agent.registeredAt).toISOString().slice(0, 10)}`}
          </dd>
          {snapshot && (
            <>
              <dt className="font-mono text-xs text-[var(--color-mute)]">last snapshot</dt>
              <dd className="font-mono text-xs text-[var(--color-ink)]">
                {snapshot.computedAt.toISOString().slice(0, 10)} · methodology v{snapshot.methodologyVersion}
              </dd>
            </>
          )}
          {agent.category && (
            <>
              <dt className="font-mono text-xs text-[var(--color-mute)]">category</dt>
              <dd>
                <Link
                  href={`/discover/category/${agent.category}`}
                  className="font-mono text-xs text-[var(--color-copper)] hover:underline"
                >
                  {agent.category}
                </Link>
              </dd>
            </>
          )}
        </dl>
        <p className="text-xs text-[var(--color-mute)] pt-2">
          <a
            href={arcscanTxUrl(agent.registeredTxHash)}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--color-copper)] hover:underline"
          >
            view registration on ArcScan ↗
          </a>
          {' · '}
          <Link href={`/agents/${id}`} className="text-[var(--color-copper)] hover:underline">
            full event history →
          </Link>
        </p>
      </section>
    </main>
  );
}

function SignalCell({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="border border-[var(--color-hairline)] bg-[var(--color-bg-elev)] rounded-[2px] p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-mute)] mb-1">
        {label}
      </div>
      <div className="font-mono text-lg font-medium text-[var(--color-ink)]">{value}</div>
      <div className="text-[10px] text-[var(--color-mute)] mt-1.5 leading-snug">{hint}</div>
    </div>
  );
}

function formatEscrow(s: string | null): string {
  if (!s) return '—';
  const n = Number(s);
  if (Number.isNaN(n) || n === 0) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}
