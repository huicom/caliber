import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db, agents } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import { AgentAvatar } from '@/components/ui/AgentAvatar';
import { Address } from '@/components/ui/Address';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ExternalLink, FileText } from 'lucide-react';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Server-side fetch hits the rating service over localhost to skip the tunnel.
const RATING_API_BASE =
  process.env.RATING_API_INTERNAL_URL ?? 'http://localhost:3100';

const SUPPORTED_CHAINS = new Set(['arc', 'base']);

type RatingResponse =
  | {
      agent_id: string;
      chain_id: string;
      rated: true;
      rating: CaliberTier;
      ppd_30d: number;
      lgd: number;
      lgd_downturn: number;
      ead_usdc: string;
      el_usdc: string;
      confidence: 'high' | 'medium' | 'low';
      view: 'PIT' | 'TTC';
      methodology_version: string;
      computed_at: string;
      factors: RatingFactors;
    }
  | {
      agent_id: string;
      chain_id: string;
      rated: false;
      reason: string;
      interactions: number;
      methodology_version: string;
    };

type CaliberTier =
  | 'Caliber-AAA'
  | 'Caliber-AA'
  | 'Caliber-A'
  | 'Caliber-BBB'
  | 'Caliber-BB'
  | 'Caliber-B'
  | 'Caliber-CCC'
  | 'Caliber-CC'
  | 'Caliber-D';

interface RatingFactors {
  segment: string;
  base_ppd: number;
  agent_age_days: number;
  validator_diversity_index: number;
  job_size_cv: number;
  recent_feedback_slope: number;
  sybil_flag: number;
  cross_chain_count: number;
  validator_quality_avg: number;
  logit: number;
  total_terminal_jobs: number;
  defaulted_jobs: number;
  interaction_count: number;
  active_default: boolean;
  lgd_assumptions: string;
  lookback_days: number | null;
}

const TIER_INFO: Record<
  CaliberTier,
  { label: string; band: number; tone: 'good' | 'fair' | 'caution' | 'bad' }
> = {
  'Caliber-AAA': { label: 'Highest quality', band: 1, tone: 'good' },
  'Caliber-AA': { label: 'Very high quality', band: 2, tone: 'good' },
  'Caliber-A': { label: 'Upper-medium grade', band: 3, tone: 'good' },
  'Caliber-BBB': { label: 'Medium grade', band: 4, tone: 'fair' },
  'Caliber-BB': { label: 'Speculative', band: 5, tone: 'fair' },
  'Caliber-B': { label: 'Highly speculative', band: 6, tone: 'caution' },
  'Caliber-CCC': { label: 'Substantial risk', band: 7, tone: 'caution' },
  'Caliber-CC': { label: 'Very high risk', band: 8, tone: 'bad' },
  'Caliber-D': { label: 'Defaulted', band: 9, tone: 'bad' },
};

const TONE_STYLES = {
  good: {
    text: 'text-[#00D4A8]',
    bg: 'bg-[#00D4A8]/10',
    border: 'border-[#00D4A8]/40',
    bar: 'bg-[#00D4A8]',
  },
  fair: {
    text: 'text-[#FFB547]',
    bg: 'bg-[#FFB547]/10',
    border: 'border-[#FFB547]/40',
    bar: 'bg-[#FFB547]',
  },
  caution: {
    text: 'text-[#FF9F45]',
    bg: 'bg-[#FF9F45]/10',
    border: 'border-[#FF9F45]/40',
    bar: 'bg-[#FF9F45]',
  },
  bad: {
    text: 'text-[#FF5C5C]',
    bg: 'bg-[#FF5C5C]/10',
    border: 'border-[#FF5C5C]/40',
    bar: 'bg-[#FF5C5C]',
  },
};

const ALL_TIERS: CaliberTier[] = [
  'Caliber-AAA',
  'Caliber-AA',
  'Caliber-A',
  'Caliber-BBB',
  'Caliber-BB',
  'Caliber-B',
  'Caliber-CCC',
  'Caliber-CC',
  'Caliber-D',
];

async function fetchRating(
  chain: string,
  id: string,
  view: 'PIT' | 'TTC',
): Promise<RatingResponse | null> {
  const url = `${RATING_API_BASE}/v1/agents/${chain}/${id}/rating?view=${view}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ chain: string; id: string }>;
}) {
  const { chain, id } = await params;
  return {
    title: `Rating ${chain}/${id} — ArcAgents`,
    description: `Performance-risk rating for ERC-8004 agent ${id} on ${chain.toUpperCase()}.`,
  };
}

export default async function RatingPage({
  params,
  searchParams,
}: {
  params: Promise<{ chain: string; id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { chain, id } = await params;
  const sp = await searchParams;
  const view: 'PIT' | 'TTC' =
    (sp.view ?? '').toUpperCase() === 'TTC' ? 'TTC' : 'PIT';

  if (!SUPPORTED_CHAINS.has(chain)) return notFound();
  if (!/^\d+$/.test(id)) return notFound();

  const agentId = BigInt(id);
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.agentId, agentId), eq(agents.chainId, chain)))
    .limit(1);

  const rating = await fetchRating(chain, id, view);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      {/* Header strip */}
      <div className="mb-6 flex items-center justify-between text-sm text-fg-mute">
        <Link
          href={agent ? `/agents/${id}` : '/agents'}
          className="inline-flex items-center gap-1.5 hover:text-fg transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {agent ? `Back to agent #${id}` : 'Back to agents'}
        </Link>
        <Link
          href="/methodology"
          className="inline-flex items-center gap-1.5 hover:text-fg transition-colors"
        >
          <FileText className="h-4 w-4" />
          Methodology
        </Link>
      </div>

      {/* Agent identity */}
      <header className="mb-8 flex items-start gap-4">
        <AgentAvatar id={id} size={64} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight truncate">
              {agent?.name ?? `Agent #${id}`}
            </h1>
            <Badge variant="muted" className="font-mono uppercase">
              {chain}
            </Badge>
          </div>
          <div className="mt-1 flex items-center gap-3 text-sm text-fg-mute">
            <span className="font-mono">#{id}</span>
            {agent?.ownerAddress ? (
              <>
                <span className="text-fg-dim">·</span>
                <Address value={agent.ownerAddress} />
              </>
            ) : null}
          </div>
        </div>
      </header>

      {/* View toggle */}
      <div className="mb-6 flex items-center gap-2">
        <ViewTab chain={chain} id={id} view="PIT" active={view === 'PIT'} />
        <ViewTab chain={chain} id={id} view="TTC" active={view === 'TTC'} />
        <span className="ml-2 text-xs text-fg-dim">
          {view === 'PIT'
            ? 'Point-in-Time (30d rolling window)'
            : 'Through-the-Cycle (full history, ≥180d required)'}
        </span>
      </div>

      {rating === null ? (
        <ErrorState />
      ) : !rating.rated ? (
        <UnratedState response={rating} />
      ) : (
        <RatedView response={rating} />
      )}

      {/* Footer */}
      <footer className="mt-12 pt-6 border-t border-border text-xs text-fg-dim flex items-center justify-between flex-wrap gap-3">
        <span>
          methodology_version{' '}
          <code className="font-mono text-fg-mute">
            {rating?.methodology_version ?? '—'}
          </code>
        </span>
        {rating && 'computed_at' in rating ? (
          <span>
            computed{' '}
            <time dateTime={rating.computed_at}>
              {new Date(rating.computed_at).toLocaleString()}
            </time>
          </span>
        ) : null}
        <Link
          href="/methodology"
          className="inline-flex items-center gap-1 text-fg-mute hover:text-fg transition-colors"
        >
          Read the methodology <ExternalLink className="h-3 w-3" />
        </Link>
      </footer>
    </main>
  );
}

function ViewTab({
  chain,
  id,
  view,
  active,
}: {
  chain: string;
  id: string;
  view: 'PIT' | 'TTC';
  active: boolean;
}) {
  return (
    <Link
      href={`/rating/${chain}/${id}?view=${view}`}
      className={
        active
          ? 'inline-flex items-center rounded-md border border-accent/40 bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent font-mono uppercase tracking-wider'
          : 'inline-flex items-center rounded-md border border-border bg-bg-elev px-3 py-1.5 text-xs font-medium text-fg-mute hover:text-fg hover:border-border-hi transition-colors font-mono uppercase tracking-wider'
      }
    >
      {view}
    </Link>
  );
}

function RatedView({
  response,
}: {
  response: Extract<RatingResponse, { rated: true }>;
}) {
  const { rating, ppd_30d, confidence, lgd, lgd_downturn, ead_usdc, el_usdc, factors } =
    response;
  const tier = TIER_INFO[rating];
  const tone = TONE_STYLES[tier.tone];

  return (
    <>
      {/* Hero: tier badge + summary stats */}
      <section className="grid lg:grid-cols-[auto_1fr] gap-6 mb-8">
        <div
          className={`rounded-2xl border ${tone.border} ${tone.bg} px-8 py-7 flex flex-col items-center justify-center min-w-[260px]`}
        >
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.15em] text-fg-dim mb-2">
            Rating
          </span>
          <div className={`text-6xl sm:text-7xl font-bold tracking-tight ${tone.text}`}>
            {rating}
          </div>
          <div className="mt-2 text-sm text-fg-mute">{tier.label}</div>
          {factors.active_default ? (
            <Badge variant="outline" className="mt-4 border-[#FF5C5C]/40 text-[#FF5C5C]">
              Active performance default
            </Badge>
          ) : (
            <Badge variant="muted" className="mt-4 font-mono uppercase">
              {confidence} confidence · {factors.interaction_count} interactions
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat
            label="30-day PPD"
            value={formatPercent(ppd_30d)}
            sub="Probability of Performance Default"
          />
          <Stat
            label="Loss Severity (LGD)"
            value={formatPercent(lgd)}
            sub={`Downturn p90 ${formatPercent(lgd_downturn)}`}
          />
          <Stat
            label="EAD"
            value={`${formatUsdc(ead_usdc)} USDC`}
            sub="In-flight funded escrow"
          />
          <Stat
            label="Expected Loss"
            value={`${formatUsdc(el_usdc)} USDC`}
            sub="PPD × LGD × EAD"
          />
        </div>
      </section>

      {/* Tier ladder */}
      <section className="mb-8 rounded-xl border border-border bg-bg-elev p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-mono uppercase tracking-wider text-fg-dim">
            Rating spectrum
          </h2>
          <span className="text-xs text-fg-dim">Caliber-AAA (lowest PPD) → Caliber-D</span>
        </div>
        <div className="flex gap-1">
          {ALL_TIERS.map((t) => {
            const ti = TIER_INFO[t];
            const isCurrent = t === rating;
            const styles = TONE_STYLES[ti.tone];
            return (
              <div key={t} className="flex-1">
                <div
                  className={`h-2 rounded-sm ${
                    isCurrent ? styles.bar : 'bg-bg-elev-2'
                  }`}
                />
                <div
                  className={`mt-2 text-center font-mono text-[0.65rem] ${
                    isCurrent ? styles.text + ' font-bold' : 'text-fg-dim'
                  }`}
                >
                  {t.replace('Caliber-', '')}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* PPD factor breakdown */}
      <section className="mb-8 rounded-xl border border-border bg-bg-elev p-6">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-sm font-mono uppercase tracking-wider text-fg-dim">
            PPD factor breakdown
          </h2>
          <span className="text-xs text-fg-dim font-mono">
            logit = {factors.logit.toFixed(3)} · segment {factors.segment}
          </span>
        </div>
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3">
          <FactorRow
            label="Empirical default rate"
            value={formatPercent(factors.base_ppd)}
            ref_="§4.2 base PPD"
            barFrac={factors.base_ppd}
            barColor="bar-red"
          />
          <FactorRow
            label="Agent age"
            value={`${factors.agent_age_days.toFixed(1)} days`}
            ref_="§4.3 — older = lower PPD"
            barFrac={Math.min(factors.agent_age_days / 180, 1)}
            barColor="bar-green"
          />
          <FactorRow
            label="Validator diversity"
            value={factors.validator_diversity_index.toFixed(3)}
            ref_="§4.3 — concentrated = higher PPD"
            barFrac={factors.validator_diversity_index}
            barColor="bar-green"
          />
          <FactorRow
            label="Job-size CV"
            value={factors.job_size_cv.toFixed(3)}
            ref_="§4.3 — high variance = higher PPD"
            barFrac={Math.min(factors.job_size_cv, 1)}
            barColor="bar-yellow"
          />
          <FactorRow
            label="Recent feedback slope"
            value={signed(factors.recent_feedback_slope)}
            ref_="§4.3 — declining = higher PPD"
            barFrac={Math.min(Math.abs(factors.recent_feedback_slope) * 10, 1)}
            barColor={
              factors.recent_feedback_slope >= 0 ? 'bar-green' : 'bar-red'
            }
          />
          <FactorRow
            label="Validator quality"
            value={factors.validator_quality_avg.toFixed(3)}
            ref_="§4.3 — better validators = lower PPD"
            barFrac={factors.validator_quality_avg}
            barColor="bar-green"
          />
          <FactorRow
            label="Cross-chain presence"
            value={`${factors.cross_chain_count} chain${factors.cross_chain_count === 1 ? '' : 's'}`}
            ref_="§4.3 — more chains = lower PPD"
            barFrac={Math.min(factors.cross_chain_count / 3, 1)}
            barColor="bar-green"
          />
          <FactorRow
            label="Sybil flag"
            value={factors.sybil_flag ? 'Flagged' : 'None'}
            ref_="§4.3 — flagged = higher PPD"
            barFrac={factors.sybil_flag}
            barColor="bar-red"
          />
        </div>
        <div className="mt-5 pt-4 border-t border-border text-xs text-fg-mute grid sm:grid-cols-2 gap-y-1">
          <span>
            Terminal jobs in window:{' '}
            <span className="font-mono text-fg">{factors.total_terminal_jobs}</span>
          </span>
          <span>
            Defaulted jobs:{' '}
            <span className="font-mono text-fg">{factors.defaulted_jobs}</span>
          </span>
          <span>
            Lookback days:{' '}
            <span className="font-mono text-fg">
              {factors.lookback_days ?? 'full history'}
            </span>
          </span>
          <span>
            Interactions counted:{' '}
            <span className="font-mono text-fg">{factors.interaction_count}</span>
          </span>
        </div>
      </section>

      {/* LGD assumptions disclosure */}
      <section className="mb-8 rounded-xl border border-border bg-bg-elev p-6">
        <h2 className="mb-3 text-sm font-mono uppercase tracking-wider text-fg-dim">
          Loss-severity assumptions
        </h2>
        <p className="text-sm leading-relaxed text-fg-mute">
          {factors.lgd_assumptions}
        </p>
      </section>
    </>
  );
}

function FactorRow({
  label,
  value,
  ref_,
  barFrac,
  barColor,
}: {
  label: string;
  value: string;
  ref_: string;
  barFrac: number;
  barColor: 'bar-green' | 'bar-yellow' | 'bar-red';
}) {
  const colorMap = {
    'bar-green': 'bg-[#00D4A8]',
    'bar-yellow': 'bg-[#FFB547]',
    'bar-red': 'bg-[#FF5C5C]',
  };
  const pct = Math.max(0, Math.min(1, barFrac)) * 100;
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-3 items-baseline">
      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-fg">{label}</span>
          <span className="font-mono text-sm tabular-nums text-fg">{value}</span>
        </div>
        <div className="mt-1 h-1 w-full rounded-full bg-bg-elev-2 overflow-hidden">
          <div
            className={`h-full ${colorMap[barColor]} transition-[width]`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-1 text-[0.7rem] text-fg-dim">{ref_}</div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-elev px-4 py-4 flex flex-col gap-1.5">
      <span className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-fg-dim">
        {label}
      </span>
      <span className="font-mono text-xl text-fg tabular-nums">{value}</span>
      {sub ? <span className="text-xs text-fg-mute">{sub}</span> : null}
    </div>
  );
}

function UnratedState({
  response,
}: {
  response: Extract<RatingResponse, { rated: false }>;
}) {
  const reasonText: Record<string, string> = {
    insufficient_interactions:
      'This agent has fewer than 5 observed interactions. Per methodology §3.2, no rating is issued below that threshold — a rating on 3 data points is noise with a label.',
    insufficient_history:
      'This agent is younger than the 14-day minimum on-chain history required by methodology §3.2. Check back once the agent has accumulated more activity.',
  };
  return (
    <section className="rounded-2xl border border-border bg-bg-elev p-8 sm:p-10 text-center">
      <Badge variant="muted" className="mb-4 uppercase font-mono">
        Not rated
      </Badge>
      <h2 className="text-2xl font-bold mb-2">No rating issued</h2>
      <p className="text-fg-mute max-w-xl mx-auto leading-relaxed">
        {reasonText[response.reason] ??
          `Rating withheld: ${response.reason.replace(/_/g, ' ')}`}
      </p>
      <div className="mt-6 inline-flex items-center gap-6 text-sm font-mono text-fg-mute">
        <span>
          interactions:{' '}
          <span className="text-fg tabular-nums">{response.interactions}</span>
        </span>
        <span>reason: <span className="text-fg">{response.reason}</span></span>
      </div>
      <div className="mt-6">
        <Link
          href="/methodology#3-rating-scale"
          className="text-accent hover:underline text-sm"
        >
          Read why →
        </Link>
      </div>
    </section>
  );
}

function ErrorState() {
  return (
    <section className="rounded-2xl border border-[#FF5C5C]/30 bg-[#FF5C5C]/5 p-8 text-center">
      <h2 className="text-xl font-bold mb-2">Rating service unreachable</h2>
      <p className="text-fg-mute">
        The rating API didn&apos;t respond in time. Refresh in a moment, or check{' '}
        <a
          href="https://caliber-api.poko.blue/health"
          className="text-accent hover:underline"
        >
          /health
        </a>
        .
      </p>
    </section>
  );
}

function formatPercent(v: number): string {
  if (v < 0.0001) return '<0.01%';
  if (v < 0.01) return `${(v * 100).toFixed(3)}%`;
  return `${(v * 100).toFixed(2)}%`;
}

function formatUsdc(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  if (n === 0) return '0.00';
  if (n < 0.01) return n.toFixed(6);
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function signed(v: number): string {
  if (v === 0) return '0';
  return `${v > 0 ? '+' : ''}${v.toFixed(4)}`;
}
