import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { db, agents, feedbackEvents, validations, jobs, ratingSnapshots } from '@/lib/db';
import { eq, desc, and, inArray } from 'drizzle-orm';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { AgentAvatar } from '@/components/ui/AgentAvatar';
import { Address } from '@/components/ui/Address';
import { ReputationStars } from '@/components/ui/ReputationStars';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { TxLink } from '@/components/ui/TxLink';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatUSDC, arcscanTxUrl } from '@/lib/format';
import { CheckCircle, Clock, ExternalLink, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { RatingTrajectoryChart } from './_components/RatingTrajectoryChart';
import { RatingExposurePanel } from './_components/RatingExposurePanel';
import { AgentExposureBreakdown } from './_components/AgentExposureBreakdown';

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const agentId = BigInt(id);

  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.agentId, agentId))
    .limit(1);
  if (!agent) return notFound();

  const [recentFeedback, allValidations, recentJobs, latestSnapshotRows, inFlightJobs] = await Promise.all([
    db
      .select()
      .from(feedbackEvents)
      .where(eq(feedbackEvents.agentId, agentId))
      .orderBy(desc(feedbackEvents.blockNumber))
      .limit(20),
    db
      .select()
      .from(validations)
      .where(eq(validations.agentId, agentId))
      .orderBy(desc(validations.requestedAtBlock)),
    db
      .select()
      .from(jobs)
      .where(eq(jobs.providerAddress, agent.ownerAddress))
      .orderBy(desc(jobs.createdAtBlock))
      .limit(20),
    // W3.5a: latest PIT snapshot drives the //rating_exposure panel.
    db
      .select()
      .from(ratingSnapshots)
      .where(and(
        eq(ratingSnapshots.agentId, agentId),
        eq(ratingSnapshots.view, 'PIT'),
      ))
      .orderBy(desc(ratingSnapshots.computedAt))
      .limit(1),
    // Funded in-flight jobs only — these are the EAD components per §6.2.
    // Open jobs without a budget set are offers, not exposure.
    db
      .select({
        jobId: jobs.jobId,
        status: jobs.status,
        budgetUsdc: jobs.budgetUsdc,
        description: jobs.description,
        createdAt: jobs.createdAt,
      })
      .from(jobs)
      .where(and(
        eq(jobs.providerAddress, agent.ownerAddress),
        inArray(jobs.status, ['Funded', 'Submitted']),
      ))
      .orderBy(desc(jobs.createdAtBlock)),
  ]);
  const latestSnapshot = latestSnapshotRows[0] ?? null;

  const isVerified = agent.validationStatus === 'PASSED';

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="grid md:grid-cols-[1fr_320px] gap-8 mb-8">
        <div className="flex gap-4">
          <AgentAvatar id={String(agent.agentId)} size={96} />
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-bold">
                {agent.name ?? `Agent #${agent.agentId}`}
              </h1>
              <span className="text-text-dim font-mono text-sm">
                #{String(agent.agentId)}
              </span>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <ReputationStars score={agent.reputationScore} />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {isVerified ? (
                <Badge className="bg-success/10 text-success border-success/30 gap-1">
                  <CheckCircle className="w-3 h-3" /> KYC VERIFIED
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1">
                  <Clock className="w-3 h-3" /> Unvalidated
                </Badge>
              )}
              {agent.agentType && (
                <Badge variant="outline">{agent.agentType}</Badge>
              )}
              {agent.capabilities?.map((cap: string) => (
                <Badge
                  key={cap}
                  variant="outline"
                  className="text-xs text-text-dim"
                >
                  {cap}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-3">
            <div>
              <div className="text-sm text-text-muted">Owner</div>
              <Address value={agent.ownerAddress} />
            </div>
            <div>
              <div className="text-sm text-text-muted">Registered</div>
              <div className="text-sm font-mono">
                Block {String(agent.registeredAtBlock)}
              </div>
            </div>
            <Button variant="outline" className="w-full" asChild>
              <a
                href={arcscanTxUrl(agent.registeredTxHash)}
                target="_blank"
                rel="noreferrer"
              >
                View on ArcScan <ExternalLink className="w-3 h-3 ml-1" />
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Feedback"
          value={String(agent.feedbackCount)}
        />
        <StatCard
          label="Jobs Completed"
          value={String(agent.jobsCompleted)}
        />
        <StatCard
          label="USDC Earned"
          value={`$${formatUSDC(agent.usdcEarned, 0)}`}
        />
        <StatCard
          label="Registered"
          value={
            agent.registeredAt
              ? new Date(agent.registeredAt).toLocaleDateString()
              : '—'
          }
        />
      </div>

      <div className="mb-8">
        <RatingExposurePanel snapshot={latestSnapshot} />
      </div>

      {latestSnapshot && (
        <div className="mb-8">
          <AgentExposureBreakdown
            snapshot={latestSnapshot}
            inFlightJobs={inFlightJobs.map((j) => ({
              jobId: j.jobId,
              status: j.status,
              budgetUsdc: j.budgetUsdc,
              description: j.description,
              createdAt: j.createdAt,
            }))}
          />
        </div>
      )}

      <div className="mb-8">
        <RatingTrajectoryChart chain="arc" agentId={id} />
      </div>

      <div className="grid md:grid-cols-[1fr_320px] gap-8">
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="reputation">Reputation</TabsTrigger>
            <TabsTrigger value="jobs">Jobs</TabsTrigger>
            <TabsTrigger value="validations">Validations</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            {agent.metadata ? (
              <Card>
                <CardHeader>
                  <CardTitle>Metadata</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="text-xs bg-bg-muted rounded-md p-4 overflow-auto max-h-64">
                    {JSON.stringify(agent.metadata, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            ) : (
              <div className="text-text-dim text-sm py-4">
                No metadata available (IPFS fetch pending).
              </div>
            )}
            {agent.metadataUri && (
              <div className="text-sm text-text-muted">
                Metadata URI:{' '}
                <a
                  href={agent.metadataUri}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand hover:underline font-mono text-xs"
                >
                  {agent.metadataUri}
                </a>
              </div>
            )}
          </TabsContent>

          <TabsContent value="reputation">
            {recentFeedback.length === 0 ? (
              <div className="text-text-dim text-sm py-4">
                No feedback received yet.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Validator</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Tag</TableHead>
                    <TableHead>Block</TableHead>
                    <TableHead>Tx</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentFeedback.map((f) => (
                    <TableRow key={String(f.id)}>
                      <TableCell>
                        <Address value={f.validatorAddress} />
                      </TableCell>
                      <TableCell className="font-mono">
                        {String(f.score)}
                      </TableCell>
                      <TableCell>{String(f.tag ?? '—')}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {String(f.blockNumber)}
                      </TableCell>
                      <TableCell>
                        {f.txHash ? (
                          <TxLink hash={f.txHash} />
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          <TabsContent value="jobs">
            {recentJobs.length === 0 ? (
              <div className="text-text-dim text-sm py-4">
                No jobs found for this agent.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job #</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Budget</TableHead>
                    <TableHead>Block</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentJobs.map((j) => (
                    <TableRow key={String(j.jobId)}>
                      <TableCell>
                        <Link
                          href={`/jobs/${j.jobId}`}
                          className="text-brand hover:underline font-mono"
                        >
                          #{String(j.jobId)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={j.status ?? ''}
                        />
                      </TableCell>
                      <TableCell className="font-mono">
                        {j.budgetUsdc
                          ? `$${formatUSDC(String(j.budgetUsdc), 0)}`
                          : '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {String(j.createdAtBlock)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          <TabsContent value="validations">
            {allValidations.length === 0 ? (
              <div className="text-text-dim text-sm py-4">
                No validations found.
              </div>
            ) : (
              <div className="space-y-2">
                {allValidations.map((v, i: number) => (
                  <Card key={i}>
                    <CardContent className="pt-4 flex items-center gap-3">
                      {v.status === 'PASSED' ? (
                        <CheckCircle className="w-5 h-5 text-success" />
                      ) : v.status === 'FAILED' ? (
                        <AlertCircle className="w-5 h-5 text-danger" />
                      ) : (
                        <Clock className="w-5 h-5 text-text-dim" />
                      )}
                      <div className="flex-1">
                        <div className="text-sm font-medium">
                          {v.status}
                          {v.tag ? ` — ${v.tag}` : null}
                        </div>
                        <div className="text-xs text-text-dim">
                          Validator:{' '}
                          <Address value={v.validatorAddress} />
                        </div>
                      </div>
                      <div className="text-xs text-text-dim text-right">
                        Block {String(v.requestedAtBlock)}
                        {v.responseTxHash ? (
                          <>
                            <br />
                            <TxLink hash={v.responseTxHash} />
                          </>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Hire this agent</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-text-muted mb-3">
                ERC-8183 on-chain job flow coming soon.
              </p>
              <Button disabled className="w-full">
                Coming Soon
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="border border-border rounded-lg p-4 bg-bg-subtle">
      <div className="text-xs text-text-muted mb-1">{label}</div>
      <div className="font-mono text-xl font-bold">{value}</div>
    </div>
  );
}
