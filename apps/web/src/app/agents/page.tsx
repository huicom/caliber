'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, type AgentRow } from '@/lib/api';
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
import { formatUSDC } from '@/lib/format';
import { Search } from 'lucide-react';

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

  const search = searchParams.get('search') ?? '';
  const sort = searchParams.get('sort') ?? 'recent';
  const page = Number(searchParams.get('page') ?? '1');
  const limit = 20;
  const offset = (page - 1) * limit;

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { sort, limit, offset };
      if (search) params.search = search;
      const data = await api.agents(params);
      setAgents(data.agents);
      setTotal(data.total);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [search, sort, offset]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

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
      <h1 className="text-3xl font-bold mb-6">Agents</h1>

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
            <SelectItem value="reputation">Reputation</SelectItem>
            <SelectItem value="earned">Earnings</SelectItem>
            <SelectItem value="jobs">Jobs</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <div className="text-text-dim text-center py-12">
          No agents found. Try a different search.
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Reputation</TableHead>
                <TableHead>Jobs</TableHead>
                <TableHead className="text-right">Earned</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((a, i) => (
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
                    <ReputationStars score={a.reputationScore} />
                  </TableCell>
                  <TableCell className="font-mono">{a.jobsCompleted}</TableCell>
                  <TableCell className="text-right font-mono">
                    ${formatUSDC(a.usdcEarned, 0)}
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
        </>
      )}
    </main>
  );
}
