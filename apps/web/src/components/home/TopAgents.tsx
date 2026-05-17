import Link from 'next/link';
import { api } from '@/lib/api';
import { AgentAvatar } from '@/components/ui/AgentAvatar';
import { ReputationStars } from '@/components/ui/ReputationStars';
import { formatUSDC } from '@/lib/format';

export async function TopAgents() {
  let data;
  try {
    data = await api.stats();
  } catch {
    return null;
  }

  const agents = data.topAgents.byReputation;

  if (agents.length === 0) {
    return (
      <div className="text-text-dim text-sm">No agents with reputation yet.</div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Top Agents by Reputation</h2>
      <div className="space-y-1">
        {agents.map((a, i) => (
          <Link
            key={a.agentId}
            href={`/agents/${a.agentId}`}
            className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-bg-muted transition-colors"
          >
            <span className="w-6 text-right text-xs text-text-dim font-mono">
              {i + 1}
            </span>
            <AgentAvatar id={a.agentId} size={36} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">
                {a.name ?? `Agent #${a.agentId}`}
              </div>
              <ReputationStars score={a.reputationScore} />
            </div>
            {a.feedbackCount !== null && (
              <span className="text-xs text-text-dim">
                {a.feedbackCount} feedback
              </span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
