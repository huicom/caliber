import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Address } from '@/components/ui/Address';
import { TxLink } from '@/components/ui/TxLink';
import {
  CheckCircle2,
  Circle,
  XCircle,
  FileText,
  DollarSign,
  Send,
  Award,
  Clock,
} from 'lucide-react';

type JobEventRow = {
  eventType: string;
  actorAddress: string;
  blockNumber: bigint;
  txHash: string;
  createdAt: Date;
};

type Props = {
  status: string;
  events: JobEventRow[];
  clientAddress: string;
  providerAddress: string;
  evaluatorAddress: string | null;
};

const PHASES: Array<{
  key: string;
  label: string;
  eventTypes: string[];
  icon: typeof CheckCircle2;
}> = [
  { key: 'posted', label: 'Posted', eventTypes: ['created'], icon: FileText },
  { key: 'funded', label: 'Funded', eventTypes: ['funded', 'budgetSet'], icon: DollarSign },
  { key: 'submitted', label: 'Submitted', eventTypes: ['submitted'], icon: Send },
  { key: 'settled', label: 'Settled', eventTypes: ['completed', 'rejected'], icon: Award },
];

function roleFor(
  actor: string,
  clientAddress: string,
  providerAddress: string,
  evaluatorAddress: string | null,
): string {
  const a = actor.toLowerCase();
  if (a === clientAddress.toLowerCase()) return 'poster';
  if (a === providerAddress.toLowerCase()) return 'agent';
  if (evaluatorAddress && a === evaluatorAddress.toLowerCase()) return 'evaluator';
  return 'unknown';
}

function relativeTime(d: Date): string {
  const ms = Date.now() - d.getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

function duration(from: Date, to: Date): string {
  const ms = to.getTime() - from.getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const days = Math.floor(h / 24);
  return `${days}d ${h % 24}h`;
}

export function LifecycleTimeline({
  status,
  events,
  clientAddress,
  providerAddress,
  evaluatorAddress,
}: Props) {
  const isRejected = status === 'Rejected';

  const rowsByPhase = PHASES.map((phase) => {
    const matches = events.filter((e) => phase.eventTypes.includes(e.eventType));
    return { phase, events: matches };
  });

  const phaseTimestamps = rowsByPhase.map((r) => r.events[0]?.createdAt ?? null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Lifecycle</span>
          {events.length > 0 && (
            <span className="text-xs font-normal text-text-dim font-mono">
              {events.length} on-chain {events.length === 1 ? 'event' : 'events'}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="relative">
          {rowsByPhase.map((row, i) => {
            const reached = row.events.length > 0;
            const isTerminalRejected = row.phase.key === 'settled' && isRejected;
            const Icon = reached
              ? isTerminalRejected
                ? XCircle
                : row.phase.icon
              : Circle;
            const iconColor = reached
              ? isTerminalRejected
                ? 'text-danger'
                : 'text-success'
              : 'text-text-dim';
            const lineColor = reached ? 'bg-success/40' : 'bg-border';

            const nextHasTime = phaseTimestamps[i + 1];
            const thisTime = phaseTimestamps[i];
            const phaseDuration =
              thisTime && nextHasTime ? duration(thisTime, nextHasTime) : null;

            return (
              <li key={row.phase.key} className="relative pl-10 pb-6 last:pb-0">
                {i < rowsByPhase.length - 1 && (
                  <span
                    className={`absolute left-4 top-7 w-px h-[calc(100%-1.25rem)] ${lineColor}`}
                    aria-hidden="true"
                  />
                )}

                <span className="absolute left-1 top-0.5 flex items-center justify-center w-7 h-7 rounded-full bg-bg-subtle border border-border">
                  <Icon className={`w-4 h-4 ${iconColor}`} />
                </span>

                <div className="flex items-baseline justify-between">
                  <h3
                    className={`text-sm font-medium ${reached ? 'text-text' : 'text-text-dim'}`}
                  >
                    {isTerminalRejected ? 'Rejected' : row.phase.label}
                  </h3>
                  {phaseDuration && (
                    <span className="text-[10px] font-mono text-text-dim flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {phaseDuration} → next
                    </span>
                  )}
                </div>

                {row.events.length === 0 && (
                  <p className="text-xs text-text-dim mt-1">pending</p>
                )}

                {row.events.map((e, idx) => {
                  const role = roleFor(
                    e.actorAddress,
                    clientAddress,
                    providerAddress,
                    evaluatorAddress,
                  );
                  return (
                    <div
                      key={`${e.txHash}-${idx}`}
                      className="mt-1.5 text-xs space-y-0.5"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-text-muted">by</span>
                        <Address value={e.actorAddress} />
                        <span className="px-1.5 py-0.5 rounded-sm bg-bg-subtle text-[10px] font-mono text-text-muted">
                          {role}
                        </span>
                        {e.eventType !== row.phase.eventTypes[0] && (
                          <span className="text-[10px] font-mono text-text-dim">
                            ({e.eventType})
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-text-dim flex items-center gap-3">
                        <span>{relativeTime(e.createdAt)}</span>
                        <span>block {String(e.blockNumber)}</span>
                        <TxLink hash={e.txHash} />
                      </div>
                    </div>
                  );
                })}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
