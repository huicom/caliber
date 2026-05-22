import Link from 'next/link';
import { AgentAvatar } from '@/components/ui/AgentAvatar';
import { RatingBadge } from '@/components/ui/RatingBadge';
import type { CaliberTier } from '@/lib/api';

interface Props {
  agentId: string;
  name: string;
  description?: string | null;
  tier?: string | null;
  jobsCompleted?: number;
  clusterSize?: number;
  category?: string | null;
  /** Optional similarity score (0-1) when shown from a search result. */
  similarity?: number;
}

// Consumer-friendly agent card for /discover. No raw addresses; the only
// CTA is "view profile" which links to the Passport. Bulk-series duplicates
// are deduped at the API layer; the cluster_size badge tells the visitor
// "this product exists as N copies — clicking takes you to the best one".
export function AgentCard({
  agentId,
  name,
  description,
  tier,
  jobsCompleted,
  clusterSize,
  category,
  similarity,
}: Props) {
  const safeTier = tier as CaliberTier | undefined;
  const summary = (description ?? '').slice(0, 110);
  return (
    <Link
      href={`/passport/arc/${agentId}`}
      className="block border border-[var(--color-hairline)] bg-white rounded-[2px] p-4 hover:border-[var(--color-ink)] hover:bg-[var(--color-bg-elev)] transition"
    >
      <div className="flex items-start gap-3">
        <AgentAvatar id={agentId} size={44} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h3 className="font-medium text-[var(--color-ink)] truncate">{name}</h3>
            {safeTier ? (
              <RatingBadge tier={safeTier} rated size="sm" />
            ) : (
              <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--color-mute)]">
                unrated
              </span>
            )}
          </div>
          {summary && (
            <p className="text-sm text-[var(--color-mute)] leading-snug mt-1 line-clamp-2">{summary}</p>
          )}
          <div className="flex items-center gap-3 mt-2 font-mono text-[10px] text-[var(--color-mute)]">
            {jobsCompleted !== undefined && jobsCompleted > 0 && (
              <span>· {jobsCompleted} jobs</span>
            )}
            {clusterSize !== undefined && clusterSize > 1 && (
              <span title={`${clusterSize} identical replicas exist`}>· × {clusterSize} replicas</span>
            )}
            {category && <span className="opacity-70">· {category}</span>}
            {similarity !== undefined && similarity > 0 && (
              <span className="ml-auto opacity-70">match {(similarity * 100).toFixed(0)}%</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
