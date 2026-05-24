'use client';

import { Suspense, useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createPublicClient, http, type Abi } from 'viem';
import { api, type CaliberTier } from '@/lib/api';
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
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatUSDC } from '@/lib/format';
import { useCaliberWallet } from '@/lib/wallet/useCaliberWallet';
import { arcTestnet } from '@/lib/wagmi/chains';
import { RATING_GATEWAY } from '@/lib/contracts/addresses';
import RatingGateway_ABI from '@/lib/contracts/abis/RatingGateway.json';

// Same ordinal ↔ tier mapping the contract and PostJobForm use (v2.0).
// Lower ordinal = stronger tier. A row's provider is "currently ineligible"
// when the provider's live tier ordinal is greater than the job's recorded
// min_tier ordinal.
const TIER_ORDINAL_TO_NAME: Record<number, CaliberTier> = {
  0: 'Gold',
  1: 'Silver',
  2: 'Bronze',
  3: 'Pending',
  4: 'Watch',
  5: 'Dormant',
};

const TIER_NAME_TO_ORDINAL: Record<CaliberTier, number> = {
  Gold: 0,
  Silver: 1,
  Bronze: 2,
  Pending: 3,
  Watch: 4,
  Dormant: 5,
};

type GatedFilter = 'all' | 'gated' | 'open';

export default function JobsPage() {
  return (
    <Suspense fallback={<JobsSkeleton />}>
      <JobList />
    </Suspense>
  );
}

function JobsSkeleton() {
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

function JobList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const wallet = useCaliberWallet();

  const [jobs, setJobs] = useState<Array<Record<string, unknown>>>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [providerRatings, setProviderRatings] = useState<Record<string, CaliberTier | null>>({});
  // jobId → original poster address (from gateway.jobPoster on-chain). Lets us
  // surface "originally posted by you" for gateway-mediated jobs where the
  // on-chain client is the RatingGateway, not the human poster.
  const [originalPosters, setOriginalPosters] = useState<Record<string, string>>({});
  const [resolvingMine, setResolvingMine] = useState(false);

  const status = searchParams.get('status') ?? '';
  const sort = searchParams.get('sort') ?? 'recent';
  const gatedParam = (searchParams.get('gated') ?? 'all') as GatedFilter;
  const mineOnly = searchParams.get('mine') === 'true';
  const page = Number(searchParams.get('page') ?? '1');
  const limit = mineOnly ? 100 : 20; // wider fetch when filtering client-side
  const offset = mineOnly ? 0 : (page - 1) * limit;

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { sort, limit, offset };
      if (status) params.status = status;
      if (gatedParam === 'gated') params.gated = 'true';
      else if (gatedParam === 'open') params.gated = 'false';
      const data = await api.jobs(params);
      setJobs(data.jobs);
      setTotal(data.total);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [status, sort, gatedParam, offset]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // When "my jobs" is on, look up gateway.jobPoster(jobId) for every gated
  // job in the current list so we can filter to those the connected wallet
  // actually posted. Direct (non-gateway) jobs use client_address directly.
  useEffect(() => {
    const gatewayLower = (RATING_GATEWAY as string).toLowerCase();
    const gatewayJobs = jobs.filter(
      (j) => typeof j.clientAddress === 'string' && j.clientAddress.toLowerCase() === gatewayLower,
    );
    if (!mineOnly || gatewayJobs.length === 0 || !wallet.address) {
      return;
    }
    let cancelled = false;
    setResolvingMine(true);
    (async () => {
      try {
        const client = createPublicClient({ chain: arcTestnet, transport: http() });
        // Fire all jobPoster reads in parallel — cheap enough for ~100 jobs.
        const reads = await Promise.all(
          gatewayJobs.map(async (j) => {
            try {
              const poster = (await client.readContract({
                address: RATING_GATEWAY as `0x${string}`,
                abi: RatingGateway_ABI as Abi,
                functionName: 'jobPoster',
                args: [BigInt(String(j.jobId))],
              })) as string;
              return [String(j.jobId), poster] as const;
            } catch {
              return [String(j.jobId), '0x0000000000000000000000000000000000000000'] as const;
            }
          }),
        );
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const [id, addr] of reads) map[id] = addr;
        setOriginalPosters(map);
      } finally {
        if (!cancelled) setResolvingMine(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobs, mineOnly, wallet.address]);

  // After jobs load, look up the live Caliber tier for every provider on a
  // gated row, then compute the "currently ineligible" marker per row.
  useEffect(() => {
    const ids = Array.from(
      new Set(
        jobs
          .filter((j) => j.minTier !== null && j.minTier !== undefined && j.providerAgentId)
          .map((j) => String(j.providerAgentId)),
      ),
    );
    if (ids.length === 0) {
      setProviderRatings({});
      return;
    }
    let cancelled = false;
    api
      .bulkRatings('arc', ids)
      .then((data) => {
        if (cancelled) return;
        const map: Record<string, CaliberTier | null> = {};
        for (const r of data.ratings) {
          map[r.agent_id] = r.rated && r.tier ? r.tier : null;
        }
        setProviderRatings(map);
      })
      .catch(() => {
        if (!cancelled) setProviderRatings({});
      });
    return () => {
      cancelled = true;
    };
  }, [jobs]);

  const updateParams = (updates: Record<string, string>) => {
    const p = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([k, v]) => {
      if (v && v !== 'all') p.set(k, v);
      else p.delete(k);
    });
    // Any filter change resets pagination
    if (updates.status !== undefined || updates.gated !== undefined) {
      p.set('page', '1');
    }
    router.push(`/jobs?${p.toString()}`);
  };

  const STATUSES = ['', 'Open', 'Funded', 'Submitted', 'Completed', 'Rejected'];
  const GATED_OPTIONS: Array<{ value: GatedFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'gated', label: 'Caliber-gated' },
    { value: 'open', label: 'Open-market' },
  ];
  const totalPages = Math.ceil(total / limit);

  const showGateCol = useMemo(
    () => jobs.some((j) => j.minTier !== null && j.minTier !== undefined),
    [jobs],
  );

  // Filter to "my posted jobs" — combines direct posts (client = wallet) +
  // gateway-mediated posts (client = gateway AND jobPoster[jobId] = wallet).
  const filteredJobs = useMemo(() => {
    if (!mineOnly || !wallet.address) return jobs;
    const me = wallet.address.toLowerCase();
    const gatewayLower = (RATING_GATEWAY as string).toLowerCase();
    return jobs.filter((j) => {
      const client = typeof j.clientAddress === 'string' ? j.clientAddress.toLowerCase() : '';
      if (client === me) return true;
      if (client === gatewayLower) {
        const original = originalPosters[String(j.jobId)]?.toLowerCase();
        return original === me;
      }
      return false;
    });
  }, [jobs, mineOnly, wallet.address, originalPosters]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-6">
        <h1 className="text-3xl font-bold">Jobs</h1>
        <CompletedExampleLink />
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-3">
        <div className="flex gap-1 flex-wrap">
          {STATUSES.map((s) => (
            <Button
              key={s || 'all'}
              variant={status === s ? 'default' : 'outline'}
              size="sm"
              onClick={() => updateParams({ status: s })}
            >
              {s || 'All'}
            </Button>
          ))}
        </div>
        <Select value={sort} onValueChange={(v) => updateParams({ sort: v })}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Most Recent</SelectItem>
            <SelectItem value="biggest">Biggest Budget</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-dim">
          //gate
        </span>
        {GATED_OPTIONS.map((g) => (
          <Button
            key={g.value}
            variant={gatedParam === g.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => updateParams({ gated: g.value })}
          >
            {g.label}
          </Button>
        ))}

        {wallet.isConnected && (
          <>
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-dim ml-3">
              //mine
            </span>
            <Button
              variant={mineOnly ? 'default' : 'outline'}
              size="sm"
              onClick={() => updateParams({ mine: mineOnly ? '' : 'true' })}
              title="Show only jobs you posted (direct + gateway-mediated)"
            >
              {mineOnly
                ? `my posted jobs${resolvingMine ? ' (loading…)' : ''}`
                : 'my posted jobs'}
            </Button>
          </>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : filteredJobs.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-text-dim text-lg mb-2">
            {mineOnly ? 'No jobs from your wallet yet' : 'No jobs yet'}
          </p>
          <p className="text-text-dim text-sm mb-6">
            {mineOnly
              ? `Posts via gateway are matched by jobPoster() against ${wallet.address?.slice(0, 10)}…${wallet.address?.slice(-6)}.`
              : 'Jobs will appear here once they are posted on-chain.'}
          </p>
          <Button variant="outline" onClick={() => router.push('/jobs/new')}>
            Post a Job
          </Button>
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job #</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Budget</TableHead>
                {showGateCol && <TableHead>Gate</TableHead>}
                <TableHead>Description</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredJobs.map((j) => {
                const minTierOrdinal =
                  j.minTier !== null && j.minTier !== undefined
                    ? Number(j.minTier)
                    : null;
                const providerAgentId = j.providerAgentId
                  ? String(j.providerAgentId)
                  : null;
                const providerCurrentTier =
                  providerAgentId ? providerRatings[providerAgentId] ?? null : null;
                const providerCurrentOrdinal =
                  providerCurrentTier ? TIER_NAME_TO_ORDINAL[providerCurrentTier] : null;
                const ineligible =
                  minTierOrdinal !== null &&
                  providerCurrentOrdinal !== null &&
                  providerCurrentOrdinal > minTierOrdinal;
                return (
                  <TableRow
                    key={String(j.job_id ?? j.jobId)}
                    className="cursor-pointer"
                    onClick={() => router.push(`/jobs/${j.jobId}`)}
                  >
                    <TableCell className="font-mono text-brand">
                      #{String(j.jobId)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={String(j.status)} />
                    </TableCell>
                    <TableCell className="font-mono">
                      {j.budgetUsdc
                        ? `$${formatUSDC(String(j.budgetUsdc), 0)}`
                        : '—'}
                    </TableCell>
                    {showGateCol && (
                      <TableCell>
                        {minTierOrdinal !== null ? (
                          <GateCell
                            minTier={TIER_ORDINAL_TO_NAME[minTierOrdinal]}
                            providerCurrentTier={providerCurrentTier}
                            ineligible={ineligible}
                          />
                        ) : (
                          <span className="text-text-dim text-xs font-mono">—</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell className="max-w-xs truncate text-text-dim">
                      {j.description
                        ? String(j.description).slice(0, 80)
                        : '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-text-dim">
                      {String(j.createdAtBlock ?? '—')}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => updateParams({ page: String(page - 1) })}
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
                onClick={() => updateParams({ page: String(page + 1) })}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </main>
  );
}

function GateCell({
  minTier,
  providerCurrentTier,
  ineligible,
}: {
  minTier: CaliberTier;
  providerCurrentTier: CaliberTier | null;
  ineligible: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className={
          ineligible
            ? 'inline-flex items-center gap-1 font-mono text-[11px] text-[var(--color-signal-down)]'
            : 'inline-flex items-center gap-1 font-mono text-[11px] text-[var(--color-copper)]'
        }
        title={
          ineligible && providerCurrentTier
            ? `Provider is currently ${providerCurrentTier}, gate requires ${minTier}. Audit signal: rating drifted since acceptance.`
            : `Gateway-enforced minimum: ${minTier}`
        }
      >
        ≥ {minTier}
      </span>
      {ineligible && (
        <span className="text-[10px] text-[var(--color-signal-down)] font-mono uppercase tracking-[0.05em]">
          ⚠ ineligible now
        </span>
      )}
    </div>
  );
}

/**
 * D3: small inline link in the page header that points to the most recent
 * completed job. Lets first-time visitors see what a finished gated job
 * looks like before browsing.
 */
function CompletedExampleLink() {
  const [jobId, setJobId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .jobs({ status: 'Completed', limit: 1, sort: 'recent' })
      .then((d) => {
        if (cancelled) return;
        const j = (d.jobs[0] as { jobId?: string | number } | undefined);
        if (j?.jobId) setJobId(String(j.jobId));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  if (!jobId) return null;
  return (
    <p className="font-mono text-[11px] text-[var(--color-mute)]">
      <span className="uppercase tracking-[0.05em] text-[10px] mr-1">//see_example</span>
      latest completed job:{' '}
      <a
        href={`/jobs/${jobId}`}
        className="text-[var(--color-copper)] hover:underline"
      >
        #{jobId} →
      </a>
    </p>
  );
}
