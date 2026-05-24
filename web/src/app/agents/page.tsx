'use client';

import { Suspense, useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, type AgentRow, type BulkRatingSummary, type CaliberTier } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AgentAvatar } from '@/components/ui/AgentAvatar';
import { ReputationStars } from '@/components/ui/ReputationStars';
import { RatingBadge } from '@/components/ui/RatingBadge';
import { formatUSDC } from '@/lib/format';
import { Search, Briefcase } from 'lucide-react';

// Caliber Rating v2.0 tier set (strongest → weakest), with display chip
// styling that mirrors RatingBadge.tsx.
const ALL_TIERS: CaliberTier[] = [
  'Gold',
  'Silver',
  'Bronze',
  'Pending',
  'Watch',
  'Dormant',
];

const TIER_COLORS: Record<CaliberTier, string> = {
  Gold:    'bg-[#B8862B]/14 border-[#B8862B]/55 text-[#B8862B]',
  Silver:  'bg-[#7E8690]/14 border-[#7E8690]/55 text-[#7E8690]',
  Bronze:  'bg-[#8C5A2C]/14 border-[#8C5A2C]/55 text-[#8C5A2C]',
  Pending: 'bg-[#98948C]/14 border-[#98948C]/55 text-[#98948C]',
  Watch:   'bg-[#B45309]/14 border-[#B45309]/55 text-[#B45309]',
  Dormant: 'bg-[#A8A39A]/14 border-[#A8A39A]/55 text-[#A8A39A]',
};

export default function AgentsPage() {
  return (
    <Suspense fallback={<AgentsSkeleton />}>
      <AgentList />
    </Suspense>
  );
}

function AgentsSkeleton() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <Skeleton className="h-8 w-48 mb-6" />
      <Skeleton className="h-10 w-full mb-6" />
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </main>
  );
}

function AgentList() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [ratings, setRatings] = useState<Record<string, BulkRatingSummary>>({});
  const [ratingsLoading, setRatingsLoading] = useState(false);

  const [selectedTiers, setSelectedTiers] = useState<Set<CaliberTier>>(new Set());
  // Default to showing unrated agents — most ERC-8004 agents on testnet are
  // unrated (insufficient interactions/history per methodology §1.5), so
  // hiding them by default makes the page look empty out of the box. Users
  // can toggle off to focus on the rated subset.
  const [showUnrated, setShowUnrated] = useState(true);

  const search = searchParams.get('search') ?? '';
  // Default sort = "rating": server orders by interaction count, so the
  // ~860 rateable agents bubble up. "Recent" stays available in the dropdown
  // for browsing new registrations.
  const sort = searchParams.get('sort') ?? 'rating';
  // ratedOnly is a one-click "hide everything the engine would reject" mode.
  // Default off so the page still represents the full registry.
  const ratedOnly = searchParams.get('ratedOnly') === 'true';
  const page = Number(searchParams.get('page') ?? '1');

  // When any per-tier filter is active, switch to "load everything rateable"
  // mode. Reason: the tier filter is client-side (the server has no rating
  // column to filter on), so we need the full rateable set in memory or the
  // filter only sees the 20-row window. ~860 rows is well within budget.
  const tierFilterActive = selectedTiers.size > 0;
  const effectiveLimit = tierFilterActive ? 1000 : 20;
  const effectiveOffset = tierFilterActive ? 0 : (page - 1) * 20;
  const limit = effectiveLimit;
  const offset = effectiveOffset;

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = {
        sort,
        limit: effectiveLimit,
        offset: effectiveOffset,
      };
      if (search) params.search = search;
      // Tier filter implies "I only care about rateable agents". Set the
      // server-side ratedOnly pre-filter so we ship ~860 rows, not 16k.
      if (ratedOnly || tierFilterActive) params.ratedOnly = 'true';
      const data = await api.agents(params);
      setAgents(data.agents);
      setTotal(data.total);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [search, sort, effectiveOffset, effectiveLimit, ratedOnly, tierFilterActive]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    if (agents.length === 0) {
      setRatings({});
      return;
    }
    let cancelled = false;
    setRatingsLoading(true);

    // The rating bulk endpoint caps at 100 ids per request, so chunk if
    // we're in tier-filter mode and may have up to ~860 rateable agents.
    const ids = agents.map((a) => a.agentId);
    const CHUNK = 100;
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));

    Promise.all(chunks.map((c) => api.bulkRatings('arc', c)))
      .then((results) => {
        if (cancelled) return;
        const map: Record<string, BulkRatingSummary> = {};
        for (const res of results) for (const r of res.ratings) map[r.agent_id] = r;
        setRatings(map);
      })
      .catch(() => {
        if (!cancelled) setRatings({});
      })
      .finally(() => {
        if (!cancelled) setRatingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agents]);

  const filteredAndSortedAgents = useMemo(() => {
    let filtered = agents.filter((a) => {
      const r = ratings[a.agentId];
      if (!r || !r.rated) return showUnrated;
      if (selectedTiers.size > 0 && !(r.tier && selectedTiers.has(r.tier))) return false;
      return true;
    });

    if (sort === 'rating') {
      filtered = [...filtered].sort((a, b) => {
        const ra = ratings[a.agentId];
        const rb = ratings[b.agentId];
        if (!ra?.rated && !rb?.rated) return 0;
        if (!ra?.rated) return 1;
        if (!rb?.rated) return -1;
        const tierOrder: Record<CaliberTier, number> = {
          Gold: 0, Silver: 1, Bronze: 2,
          Pending: 3, Watch: 4, Dormant: 5,
        };
        return (tierOrder[ra.tier!] ?? 99) - (tierOrder[rb.tier!] ?? 99);
      });
    }

    return filtered;
  }, [agents, ratings, selectedTiers, showUnrated, sort]);

  const toggleTier = (tier: CaliberTier) => {
    const next = new Set(selectedTiers);
    if (next.has(tier)) next.delete(tier);
    else next.add(tier);
    setSelectedTiers(next);
  };

  const updateParams = (updates: Record<string, string>) => {
    const p = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([k, v]) => {
      if (v) p.set(k, v);
      else p.delete(k);
    });
    if (updates.search !== undefined) p.set('page', '1');
    router.push(`/agents?${p.toString()}`);
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 space-y-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-3xl font-bold">Agents</h1>
          <span
            className="font-mono text-[10px] uppercase tracking-[0.05em] px-2 py-0.5 rounded-[2px] border border-accent text-accent bg-accent/5"
            title="Raw ERC-8004 registry — every on-chain registration. 88% of agents on Arc Testnet ship with placeholder metadata (no fetchable name, generic avatar)."
          >
            raw · unfiltered · ~88% have placeholder metadata
          </span>
        </div>
        <p className="text-sm text-text-dim leading-relaxed max-w-3xl">
          This is the unfiltered ERC-8004 registry on Arc Testnet — every agent ever registered,
          including the ~88% with no fetchable IPFS metadata (they render as{' '}
          <span className="font-mono text-xs">Agent #N</span>). Looking for the curated,
          deduplicated, semantically-searchable view? →{' '}
          <Link href="/discover" className="text-accent hover:underline font-medium">
            Discover
          </Link>
          .
        </p>
      </div>

      <div className="flex gap-6">
        <aside className="hidden lg:block w-52 shrink-0">
          <div className="sticky top-24 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-text-muted mb-2">Rating Filter</h3>
              <div className="space-y-1">
                {ALL_TIERS.map((tier) => {
                  const active = selectedTiers.has(tier);
                  return (
                    <button
                      key={tier}
                      onClick={() => toggleTier(tier)}
                      className={`w-full text-left px-2 py-1 rounded text-xs font-mono border transition-colors ${
                        active
                          ? TIER_COLORS[tier]
                          : 'border-border bg-bg-subtle text-text-dim hover:border-accent/40'
                      }`}
                    >
                      {tier.replace('Caliber-', '')}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => updateParams({ ratedOnly: ratedOnly ? '' : 'true' })}
                className={`px-2 py-1 rounded text-xs border transition-colors ${
                  ratedOnly
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border bg-bg-subtle text-text-dim hover:border-accent/40'
                }`}
                title="Server-side pre-filter: only show agents likely to clear the §1.5 minimum (≥5 interactions)"
              >
                Rated only
              </button>
              <button
                onClick={() => setShowUnrated(!showUnrated)}
                className={`px-2 py-1 rounded text-xs border transition-colors ${
                  showUnrated
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border bg-bg-subtle text-text-dim hover:border-accent/40'
                }`}
                title="Client-side: include rows where the engine returned Insufficient confidence"
              >
                Show unrated
              </button>
              {selectedTiers.size > 0 && (
                <button
                  onClick={() => setSelectedTiers(new Set())}
                  className="text-xs text-text-dim hover:text-accent"
                >
                  Clear tiers
                </button>
              )}
            </div>
          </div>
        </aside>

        <div className="flex-1 min-w-0">
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-dim" />
              <Input
                placeholder="Search by name, address, or agent ID..."
                className="pl-9"
                defaultValue={search}
                onKeyDown={(e) => {
                  if (e.key === 'Enter')
                    updateParams({ search: (e.target as HTMLInputElement).value });
                }}
              />
            </div>
            <Select
              value={sort}
              onValueChange={(v) => updateParams({ sort: v })}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Recent</SelectItem>
                <SelectItem value="rating">Rating (best)</SelectItem>
                <SelectItem value="reputation">Reputation</SelectItem>
                <SelectItem value="earned">Earnings</SelectItem>
                <SelectItem value="jobs">Jobs</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="lg:hidden flex gap-1.5 flex-wrap items-center mb-4">
            <button
              onClick={() => updateParams({ ratedOnly: ratedOnly ? '' : 'true' })}
              className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                ratedOnly
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border bg-bg-subtle text-text-dim'
              }`}
            >
              Rated only
            </button>
            <span className="h-4 w-px bg-border mx-0.5" aria-hidden />
            {ALL_TIERS.map((tier) => {
              const active = selectedTiers.has(tier);
              return (
                <button
                  key={tier}
                  onClick={() => toggleTier(tier)}
                  className={`px-2 py-0.5 rounded text-xs font-mono border transition-colors ${
                    active
                      ? TIER_COLORS[tier]
                      : 'border-border bg-bg-subtle text-text-dim'
                  }`}
                >
                  {tier.replace('Caliber-', '')}
                </button>
              );
            })}
            <button
              onClick={() => setShowUnrated(!showUnrated)}
              className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                showUnrated
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border bg-bg-subtle text-text-dim'
              }`}
            >
              Show unrated
            </button>
            {selectedTiers.size > 0 && (
              <button
                onClick={() => setSelectedTiers(new Set())}
                className="text-xs text-text-dim hover:text-accent"
              >
                Clear tiers
              </button>
            )}
          </div>

          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredAndSortedAgents.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-text-dim text-lg mb-2">
                {selectedTiers.size > 0 || !showUnrated
                  ? 'No agents match your filters'
                  : 'No agents found'}
              </p>
              <p className="text-text-dim text-sm">
                {selectedTiers.size > 0 || !showUnrated
                  ? 'Try enabling "Unrated" or selecting more rating tiers.'
                  : 'Try a different search term.'}
              </p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead className="hidden md:table-cell">Score</TableHead>
                    <TableHead className="hidden md:table-cell">Confidence</TableHead>
                    <TableHead>Reputation</TableHead>
                    <TableHead>Jobs</TableHead>
                    <TableHead className="text-right">Earned</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedAgents.map((a, i) => {
                    const r = ratings[a.agentId];
                    return (
                      <TableRow
                        key={a.agentId}
                        className="cursor-pointer"
                        onClick={() => router.push(`/agents/${a.agentId}`)}
                      >
                        <TableCell className="font-mono text-xs text-text-dim">
                          {offset + i + 1}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <AgentAvatar id={a.agentId} size={36} />
                            <div>
                              <div className="font-medium">
                                {a.name ?? `Agent #${a.agentId}`}
                              </div>
                              <div className="text-xs text-text-dim">
                                #{a.agentId}
                                {a.agentType && (
                                  <Badge variant="outline" className="ml-2 text-[10px]">
                                    {a.agentType}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <RatingBadge
                            tier={r?.tier}
                            rated={r?.rated ?? false}
                            reason={r?.reason}
                            loading={ratingsLoading && !r}
                            chain="arc"
                            agentId={a.agentId}
                            size="sm"
                          />
                        </TableCell>
                        <TableCell className="hidden md:table-cell font-mono text-xs text-text-dim">
                          {r?.score != null ? r.score : '—'}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs">
                          {r?.confidence ? (
                            <span
                              className={
                                r.confidence === 'high'
                                  ? 'text-[#047857]'
                                  : r.confidence === 'moderate'
                                    ? 'text-[#075985]'
                                    : r.confidence === 'low'
                                      ? 'text-[#B45309]'
                                      : 'text-[#C2410C]'
                              }
                            >
                              {r.confidence}
                            </span>
                          ) : (
                            <span className="text-text-dim">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <ReputationStars score={a.reputationScore} />
                        </TableCell>
                        <TableCell className="font-mono">{a.jobsCompleted}</TableCell>
                        <TableCell className="text-right font-mono">
                          ${formatUSDC(a.usdcEarned, 0)}
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/jobs/new?agent=arc:${a.agentId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-accent/40 text-accent hover:bg-accent/10 transition-colors"
                          >
                            <Briefcase className="w-3 h-3" />
                            Hire
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {!tierFilterActive && totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-6">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() =>
                      updateParams({ page: String(page - 1) })
                    }
                  >
                    Prev
                  </Button>
                  <span className="text-sm text-text-muted px-3">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() =>
                      updateParams({ page: String(page + 1) })
                    }
                  >
                    Next
                  </Button>
                </div>
              )}
              {tierFilterActive && (
                <p className="text-center text-xs text-text-dim mt-6">
                  Showing all {filteredAndSortedAgents.length} agents matching your tier filter
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}