'use client';

import { Suspense, useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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

// Same ordinal ↔ tier mapping the contract and PostJobForm use. Lower
// ordinal = stronger tier. A row's provider is "currently ineligible" when
// the provider's live tier ordinal is greater than the job's recorded
// min_tier ordinal.
const TIER_ORDINAL_TO_NAME: Record<number, CaliberTier> = {
  0: 'Caliber-AAA',
  1: 'Caliber-AA',
  2: 'Caliber-A',
  3: 'Caliber-BBB',
  4: 'Caliber-BB',
  5: 'Caliber-B',
  6: 'Caliber-CCC',
  7: 'Caliber-CC',
  8: 'Caliber-D',
};

const TIER_NAME_TO_ORDINAL: Record<CaliberTier, number> = {
  'Caliber-AAA': 0,
  'Caliber-AA': 1,
  'Caliber-A': 2,
  'Caliber-BBB': 3,
  'Caliber-BB': 4,
  'Caliber-B': 5,
  'Caliber-CCC': 6,
  'Caliber-CC': 7,
  'Caliber-D': 8,
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

  const [jobs, setJobs] = useState<Array<Record<string, unknown>>>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [providerRatings, setProviderRatings] = useState<Record<string, CaliberTier | null>>({});

  const status = searchParams.get('status') ?? '';
  const sort = searchParams.get('sort') ?? 'recent';
  const gatedParam = (searchParams.get('gated') ?? 'all') as GatedFilter;
  const page = Number(searchParams.get('page') ?? '1');
  const limit = 20;
  const offset = (page - 1) * limit;

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
          map[r.agent_id] = r.rated && r.rating ? r.rating : null;
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

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Jobs</h1>

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

      <div className="flex items-center gap-2 mb-6">
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
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-text-dim text-lg mb-2">No jobs yet</p>
          <p className="text-text-dim text-sm mb-6">Jobs will appear here once they are posted on-chain.</p>
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
              {jobs.map((j) => {
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
