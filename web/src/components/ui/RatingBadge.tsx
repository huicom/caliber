import * as React from 'react';
import Link from 'next/link';
import type { CaliberTier } from '@/lib/api';
import { cn } from '@/lib/utils';

/*
 * Tier badge palette — contrast-tuned for the light theme.
 *
 * Each tier keeps its brand HUE (green / amber / orange / red) but the
 * TEXT color is a darker shade of that hue so WCAG-AA contrast holds on
 * a white background. The brand hue still lives in the border + a 22%
 * background wash, which gives the badge its identity without crushing
 * legibility. See globals.css `--tier-*` tokens.
 */
const TIER_STYLES: Record<CaliberTier, string> = {
  'Caliber-AAA': 'border-[#00B894]/50 bg-[#00B894]/12 text-[#047857]',
  'Caliber-AA':  'border-[#00B894]/50 bg-[#00B894]/12 text-[#047857]',
  'Caliber-A':   'border-[#00B894]/50 bg-[#00B894]/12 text-[#047857]',
  'Caliber-BBB': 'border-[#F59E0B]/55 bg-[#F59E0B]/14 text-[#B45309]',
  'Caliber-BB':  'border-[#F59E0B]/55 bg-[#F59E0B]/14 text-[#B45309]',
  'Caliber-B':   'border-[#FB923C]/55 bg-[#FB923C]/14 text-[#C2410C]',
  'Caliber-CCC': 'border-[#FB923C]/55 bg-[#FB923C]/14 text-[#C2410C]',
  'Caliber-CC':  'border-[#EF4444]/55 bg-[#EF4444]/14 text-[#B91C1C]',
  'Caliber-D':   'border-[#EF4444]/55 bg-[#EF4444]/14 text-[#B91C1C]',
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
    <span className={cn(base, TIER_STYLES[tier])}>{tier.replace('Caliber-', '')}</span>
  );

  if (chain && agentId) {
    return (
      <Link
        href={`/rating/${chain}/${agentId}`}
        className="hover:opacity-80 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        {content}
      </Link>
    );
  }
  return content;
}
