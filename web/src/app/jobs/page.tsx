'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
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

  const status = searchParams.get('status') ?? '';
  const sort = searchParams.get('sort') ?? 'recent';
  const page = Number(searchParams.get('page') ?? '1');
  const limit = 20;
  const offset = (page - 1) * limit;

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { sort, limit, offset };
      if (status) params.status = status;
      const data = await api.jobs(params);
      setJobs(data.jobs);
      setTotal(data.total);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [status, sort, offset]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const updateParams = (updates: Record<string, string>) => {
    const p = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([k, v]) => {
      if (v) p.set(k, v);
      else p.delete(k);
    });
    if (updates.status !== undefined) p.set('page', '1');
    router.push(`/jobs?${p.toString()}`);
  };

  const STATUSES = ['', 'Open', 'Funded', 'Submitted', 'Completed', 'Rejected'];
  const totalPages = Math.ceil(total / limit);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Jobs</h1>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
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

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="text-text-dim text-center py-12">No jobs found.</div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job #</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Budget</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((j) => (
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
                  <TableCell className="max-w-xs truncate text-text-dim">
                    {j.description
                      ? String(j.description).slice(0, 80)
                      : '—'}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-text-dim">
                    {String(j.createdAtBlock ?? '—')}
                  </TableCell>
                </TableRow>
              ))}
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
