import * as React from 'react';
import Link from 'next/link';
import type { CaliberTier } from '@/lib/api';
import { cn } from '@/lib/utils';

/*
 * Caliber Rating v2.0 tier palette — contrast-tuned for the light theme.
 *
 *   Gold → green (strong, proven)
 *   Silver      → blue (reliable, decent sample)
 *   Bronze    → teal (promising, limited)
 *   Pending → grey (insufficient data, anchored to mean)
 *   Watch       → amber (risk flag triggered)
 *   Dormant    → ink/dark (dormant)
 *
 * Each tier keeps a brand HUE on the border and a 14% background wash;
 * text color is a darker shade of that hue so WCAG-AA contrast holds.
 */
const TIER_STYLES: Record<CaliberTier, string> = {
  Gold: 'border-[#00B894]/55 bg-[#00B894]/14 text-[#047857]',
  Silver:      'border-[#0EA5E9]/55 bg-[#0EA5E9]/14 text-[#075985]',
  Bronze:    'border-[#14B8A6]/55 bg-[#14B8A6]/14 text-[#0F766E]',
  Pending: 'border-[#94A3B8]/55 bg-[#94A3B8]/14 text-[#475569]',
  Watch:       'border-[#F59E0B]/55 bg-[#F59E0B]/14 text-[#B45309]',
  Dormant:    'border-[#1F2937]/55 bg-[#1F2937]/14 text-[#111827]',
};

interface Props {
  tier?: CaliberTier;
  rated: boolean;
  reason?: string;
  loading?: boolean;
  chain?: string;
  agentId?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function RatingBadge({
  tier,
  rated,
  reason,
  loading,
  chain,
  agentId,
  size = 'md',
  className,
}: Props) {
  const base = cn(
    'inline-flex items-center justify-center rounded-md border font-mono font-semibold tracking-tight',
    size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-sm',
    className,
  );

  if (loading) {
    return (
      <div
        className={cn(
          base,
          'border-border bg-bg-elev-2 text-fg-dim animate-pulse',
        )}
      >
        ···
      </div>
    );
  }

  if (!rated || !tier) {
    return (
      <span
        className={cn(
          base,
          'border-border bg-bg-elev-2 text-fg-dim',
        )}
        title={reason ? `Unrated: ${reason.replace(/_/g, ' ')}` : 'Unrated'}
      >
        —
      </span>
    );
  }

  const content = (
    <span className={cn(base, TIER_STYLES[tier])}>{tier}</span>
  );

  if (chain && agentId) {
    return (
      <Link
        href={`/passport/${chain}/${agentId}`}
        className="hover:opacity-80 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        {content}
      </Link>
    );
  }
  return content;
}
