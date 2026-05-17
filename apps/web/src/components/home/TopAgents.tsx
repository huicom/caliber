import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { db, agents } from '@/lib/db';
import { desc, sql as drizzleSql } from 'drizzle-orm';
import { AgentAvatar } from '@/components/ui/AgentAvatar';
import { ReputationStars } from '@/components/ui/ReputationStars';

interface TopAgent {
  agentId: string;
  name: string | null;
  reputationScore: string | null;
  feedbackCount: number | null;
}

async function fetchTopAgents(): Promise<TopAgent[] | null> {
  try {
    const rows = await db
      .select({
        agentId: agents.agentId,
        name: agents.name,
        reputationScore: agents.reputationScore,
        feedbackCount: agents.feedbackCount,
      })
      .from(agents)
      .where(drizzleSql`reputation_score IS NOT NULL`)
      .orderBy(desc(agents.reputationScore))
      .limit(10);
    return rows.map((r) => ({
      agentId: String(r.agentId),
      name: r.name,
      reputationScore: r.reputationScore == null ? null : String(r.reputationScore),
      feedbackCount: r.feedbackCount == null ? null : Number(r.feedbackCount),
    }));
  } catch {
    return null;
  }
}

export async function TopAgents() {
  const list = await fetchTopAgents();

  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="font-mono text-xs uppercase tracking-[0.12em] text-fg-dim">
          //top_agents
        </h2>
        <Link
          href="/agents"
          className="text-xs font-mono text-fg-dim hover:text-accent transition-colors"
        >
          all agents →
        </Link>
      </div>

      {!list || list.length === 0 ? (
        <div className="border border-border rounded-xl bg-bg-elev px-6 py-10 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.1em] text-fg-dim mb-2">
            {list === null ? 'top agents unavailable' : 'no reputation data yet'}
          </p>
          <p className="text-sm text-fg-mute">
            {list === null
              ? 'Database query failed.'
              : 'Reputation populates as feedback events land on-chain.'}
          </p>
        </div>
      ) : (
        <ul className="border border-border rounded-xl bg-bg-elev overflow-hidden divide-y divide-border">
          {list.map((a, i) => (
            <li key={a.agentId}>
              <Link
                href={`/agents/${a.agentId}`}
                className="group flex items-center gap-4 px-4 py-3 hover:bg-bg-elev-2 transition-colors"
              >
                <span className="w-6 text-right font-mono text-xs text-fg-dim shrink-0">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <AgentAvatar id={a.agentId} size={36} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-fg truncate">
                    {a.name ?? `Agent #${a.agentId}`}
                  </div>
                  <ReputationStars score={a.reputationScore} />
                </div>
                {a.feedbackCount !== null && (
                  <span className="font-mono text-xs text-fg-dim shrink-0 tabular-nums">
                    {a.feedbackCount}
                    <span className="text-fg-dim/60 ml-1">fb</span>
                  </span>
                )}
                <ChevronRight
                  className="w-4 h-4 text-fg-dim opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
