import Link from 'next/link';
import { type RatingSnapshot } from '@arc-agents/db';

// Mirrors the registry-wide //active_exposure panel on /stats, but with the
// agent itself as the unit and the agent's in-flight jobs as the breakdown.
// Renders only when the agent has a current snapshot — without PD/LGD there's
// nothing to multiply the budgets against.

interface InFlightJob {
  jobId: bigint;
  status: string;
  budgetUsdc: string | null;
  description: string | null;
  createdAt: Date;
}

interface Props {
  snapshot: RatingSnapshot | null;
  inFlightJobs: InFlightJob[];
}

function formatUsdc(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n > 0) return `$${n.toFixed(4)}`;
  return '$0';
}

function ageString(createdAt: Date): string {
  const ms = Date.now() - createdAt.getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours}h`;
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  return `${minutes}m`;
}

const ROW_CAP = 20;

export function AgentExposureBreakdown({ snapshot, inFlightJobs }: Props) {
  if (!snapshot) return null;

  const pd = snapshot.ppd30d ? Number(snapshot.ppd30d) : 0;
  const lgd = snapshot.lgd ? Number(snapshot.lgd) : 0;
  const pdLgd = pd * lgd;

  // Sort by budget desc so the highest contributors land at the top.
  const sortedJobs = [...inFlightJobs].sort((a, b) => {
    const aB = Number(a.budgetUsdc ?? 0);
    const bB = Number(b.budgetUsdc ?? 0);
    return bB - aB;
  });

  const totalBudget = sortedJobs.reduce(
    (acc, j) => acc + Number(j.budgetUsdc ?? 0),
    0,
  );
  const totalEl = totalBudget * pdLgd;
  const hiddenCount = Math.max(0, sortedJobs.length - ROW_CAP);
  const visibleJobs = sortedJobs.slice(0, ROW_CAP);

  return (
    <section className="border border-[var(--color-hairline)] bg-white rounded-[2px] p-5">
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="font-mono text-[13px] text-[var(--color-ink)] tracking-[0.02em]">
            //exposure_breakdown
          </h2>
          <p className="text-xs text-[var(--color-mute)] mt-1 leading-snug">
            Where this agent&apos;s current escrow exposure comes from.
            EAD is the sum of all in-flight jobs; expected loss is each
            job&apos;s budget × this agent&apos;s PD × LGD.
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-[var(--color-mute)]">
          as of {new Date().toISOString().slice(0, 10)}
        </span>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mb-5">
        <Stat
          label="in-flight jobs"
          value={String(inFlightJobs.length)}
          hint={
            inFlightJobs.length === 1
              ? '1 job currently in escrow'
              : `${inFlightJobs.length} jobs currently in escrow`
          }
        />
        <Stat
          label="current ead"
          value={formatUsdc(totalBudget)}
          hint="funded USDC across all in-flight jobs (§6.2)"
          copper
        />
        <Stat
          label="expected loss"
          value={formatUsdc(totalEl)}
          hint={`PD × LGD × EAD · ${(pdLgd * 100).toFixed(2)}% of EAD`}
        />
      </div>

      {inFlightJobs.length === 0 ? (
        <div className="border border-dashed border-[var(--color-hairline)] rounded-[2px] p-6 text-xs font-mono text-[var(--color-mute)] text-center">
          no in-flight jobs — this agent has no current escrow exposure
        </div>
      ) : (
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--color-mute)] mb-2">
            //job_by_job
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono min-w-[640px]">
              <thead className="text-[var(--color-mute)]">
                <tr>
                  <th className="text-left pb-2 font-normal">job</th>
                  <th className="text-left pb-2 font-normal">status</th>
                  <th className="text-left pb-2 font-normal">age</th>
                  <th className="text-right pb-2 font-normal">budget (ead)</th>
                  <th className="text-right pb-2 font-normal">pd × lgd</th>
                  <th className="text-right pb-2 font-normal">expected loss</th>
                  <th className="text-right pb-2 font-normal">share</th>
                </tr>
              </thead>
              <tbody className="text-[var(--color-ink)]">
                {visibleJobs.map((j) => {
                  const budget = Number(j.budgetUsdc ?? 0);
                  const el = budget * pdLgd;
                  const share = totalBudget > 0 ? (budget / totalBudget) * 100 : 0;
                  return (
                    <tr
                      key={String(j.jobId)}
                      className="border-t border-[var(--color-hairline)]"
                    >
                      <td className="py-1.5">
                        <Link
                          href={`/jobs/${j.jobId}`}
                          className="text-[var(--color-copper)] hover:underline"
                        >
                          #{String(j.jobId)}
                        </Link>
                      </td>
                      <td className="py-1.5 text-[var(--color-mute)]">{j.status}</td>
                      <td className="py-1.5 text-[var(--color-mute)]">
                        {ageString(j.createdAt)}
                      </td>
                      <td className="py-1.5 text-right">{formatUsdc(budget)}</td>
                      <td className="py-1.5 text-right text-[var(--color-mute)]">
                        {(pdLgd * 100).toFixed(2)}%
                      </td>
                      <td className="py-1.5 text-right">{formatUsdc(el)}</td>
                      <td className="py-1.5 text-right text-[var(--color-mute)]">
                        {share.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {visibleJobs.length > 1 && (
                <tfoot className="text-[var(--color-ink)]">
                  <tr className="border-t-2 border-[var(--color-ink)]">
                    <td className="pt-2 pb-1 font-mono text-[10px] uppercase tracking-[0.05em] text-[var(--color-mute)]" colSpan={3}>
                      total{hiddenCount > 0 ? ` (top ${ROW_CAP} of ${sortedJobs.length})` : ''}
                    </td>
                    <td className="pt-2 pb-1 text-right font-medium">
                      {formatUsdc(
                        visibleJobs.reduce((a, j) => a + Number(j.budgetUsdc ?? 0), 0),
                      )}
                    </td>
                    <td className="pt-2 pb-1"></td>
                    <td className="pt-2 pb-1 text-right font-medium">
                      {formatUsdc(
                        visibleJobs.reduce(
                          (a, j) => a + Number(j.budgetUsdc ?? 0) * pdLgd,
                          0,
                        ),
                      )}
                    </td>
                    <td className="pt-2 pb-1"></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {hiddenCount > 0 && (
            <p className="font-mono text-[10px] text-[var(--color-mute)] mt-3">
              // +{hiddenCount} more in-flight jobs not shown · table caps at
              top {ROW_CAP} by budget
            </p>
          )}
        </div>
      )}

      <p className="text-[10px] text-[var(--color-mute)] mt-4 leading-snug">
        EAD includes only actually-funded ERC-8183 escrow per methodology §6.2.
        Unfunded commitments and CCF-style modeling are deferred to v2.
        Per-agent PD and LGD are read from the latest daily snapshot
        (computed {snapshot.computedAt.toISOString().slice(0, 10)}).
      </p>
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  copper,
}: {
  label: string;
  value: string;
  hint?: string;
  copper?: boolean;
}) {
  return (
    <div className="border border-[var(--color-hairline)] bg-[var(--color-bg-elev)] rounded-[2px] p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-mute)] mb-1">
        {label}
      </div>
      <div
        className={
          'font-mono text-xl font-medium ' +
          (copper ? 'text-[var(--color-copper)]' : 'text-[var(--color-ink)]')
        }
      >
        {value}
      </div>
      {hint && (
        <div className="text-[10px] text-[var(--color-mute)] mt-1.5 leading-snug">
          {hint}
        </div>
      )}
    </div>
  );
}
