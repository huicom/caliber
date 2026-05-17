import { notFound } from 'next/navigation';
import { db, agents, jobs, jobEvents } from '@/lib/db';
import { eq, asc } from 'drizzle-orm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Address } from '@/components/ui/Address';
import { TxLink } from '@/components/ui/TxLink';
import { formatUSDC } from '@/lib/format';
import { CheckCircle, Circle, XCircle } from 'lucide-react';
import Link from 'next/link';

const STEP_ORDER = ['Open', 'Funded', 'Submitted', 'Completed'];

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

  const status = job.status ?? '';
  const isRejected = status === 'Rejected';
  const currentStepIdx = isRejected
    ? STEP_ORDER.indexOf('Submitted')
    : STEP_ORDER.indexOf(status);

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

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Lifecycle</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            {STEP_ORDER.map((step, i) => {
              const reached = i <= currentStepIdx;
              const isCurrent = i === currentStepIdx;
              const Icon = reached
                ? isCurrent && isRejected
                  ? XCircle
                  : CheckCircle
                : Circle;
              const iconColor = reached
                ? isCurrent && isRejected
                  ? 'text-danger'
                  : 'text-success'
                : 'text-text-dim';
              return (
                <div
                  key={step}
                  className="flex flex-col items-center flex-1"
                >
                  <Icon
                    className={`w-6 h-6 ${iconColor} ${isCurrent ? 'animate-pulse' : ''}`}
                  />
                  <span
                    className={`text-xs mt-1 ${reached ? 'text-text' : 'text-text-dim'}`}
                  >
                    {isCurrent && isRejected ? 'Rejected' : step}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {timeline.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Event Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {timeline.map((e, i) => (
                <div key={i} className="flex gap-3 text-sm">
                  <div className="flex flex-col items-center">
                    <div className="w-2 h-2 rounded-full bg-brand mt-1.5" />
                    {i < timeline.length - 1 && (
                      <div className="w-px flex-1 bg-border mt-1" />
                    )}
                  </div>
                  <div className="flex-1 pb-3">
                    <div className="font-medium capitalize">
                      {e.eventType}
                    </div>
                    <div className="text-xs text-text-dim space-x-2">
                      <span>Block {String(e.blockNumber)}</span>
                      <span>
                        <TxLink hash={e.txHash} />
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
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
