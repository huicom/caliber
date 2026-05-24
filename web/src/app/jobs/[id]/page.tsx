import { notFound } from 'next/navigation';
import { db, agents, jobs, jobEvents, jobDrafts } from '@/lib/db';
import { eq, asc } from 'drizzle-orm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Address } from '@/components/ui/Address';
import { formatUSDC } from '@/lib/format';
import Link from 'next/link';
import { OnChainJobState } from './_components/OnChainJobState';
import { JobActions } from './_components/JobActions';
import { CaliberBondPanel } from './_components/CaliberBondPanel';
import { LifecycleTimeline } from './_components/LifecycleTimeline';

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const jobId = BigInt(id);

  const [job] = await db
    .select()
    .from(jobs)
    .where(eq(jobs.jobId, jobId))
    .limit(1);
  if (!job) return notFound();

  const [timeline, provider] = await Promise.all([
    db
      .select()
      .from(jobEvents)
      .where(eq(jobEvents.jobId, jobId))
      .orderBy(asc(jobEvents.blockNumber)),
    db
      .select({
        agentId: agents.agentId,
        name: agents.name,
        reputationScore: agents.reputationScore,
      })
      .from(agents)
      .where(eq(agents.ownerAddress, job.providerAddress))
      .limit(1),
  ]);

  // Pull bond_required from the job draft so CaliberBondPanel renders only
  // when the poster opted in at post-time. Draft hash is embedded in the
  // on-chain description as `arcagents:draft:<hash>`.
  let bondRequired = false;
  const descMatch = job.description?.match(/arcagents:draft:(0x[a-fA-F0-9]+)/);
  if (descMatch?.[1]) {
    const draft = await db
      .select({ bondRequired: jobDrafts.bondRequired })
      .from(jobDrafts)
      .where(eq(jobDrafts.draftHash, descMatch[1]))
      .limit(1);
    bondRequired = draft[0]?.bondRequired ?? false;
  }

  const status = job.status ?? '';

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <h1 className="text-3xl font-bold">
            Job #{String(job.jobId)}
          </h1>
          <StatusBadge status={status} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Budget"
            value={
              job.budgetUsdc
                ? `$${formatUSDC(String(job.budgetUsdc), 2)} USDC`
                : 'Not set'
            }
          />
          <StatCard
            label="Client"
            value={<Address value={job.clientAddress} />}
          />
          <StatCard
            label="Provider"
            value={<Address value={job.providerAddress} />}
          />
          {provider[0] && (
            <StatCard
              label="Provider Agent"
              value={
                <Link
                  href={`/agents/${provider[0].agentId}`}
                  className="text-brand hover:underline"
                >
                  {provider[0].name ?? `#${provider[0].agentId}`}
                </Link>
              }
            />
          )}
        </div>
      </div>

      {job.description && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-text-muted whitespace-pre-wrap">
              {job.description}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="mb-8">
        <OnChainJobState jobId={id} />
      </div>

      <div className="mb-8">
        <JobActions jobId={id} />
      </div>

      {bondRequired && (
        <div className="mb-8">
          <CaliberBondPanel
            jobId={id}
            providerAddress={job.providerAddress}
            providerAgentId={provider[0]?.agentId ? String(provider[0].agentId) : null}
            budgetRaw={job.budgetRaw}
            jobStatus={status}
          />
        </div>
      )}

      <LifecycleTimeline
        status={status}
        events={timeline}
        clientAddress={job.clientAddress}
        providerAddress={job.providerAddress}
        evaluatorAddress={job.evaluatorAddress}
      />
    </main>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded-lg p-4 bg-bg-subtle">
      <div className="text-xs text-text-muted mb-1">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}
