'use client';

import { StatBlock } from '@/components/ui/StatBlock';
import {
  useLive,
  useNowTick,
  formatRelative,
} from '@/components/live/LiveContext';

export function LastEventStat() {
  useNowTick(1000);
  const { lastBlock, lastEventAt } = useLive();

  if (!lastBlock) {
    return <StatBlock label="Last event" value="" loading />;
  }

  const ago = formatRelative(lastEventAt);

  return (
    <StatBlock
      label="Last event"
      live
      value={
        <span className="tabular-nums">
          {ago ?? <span className="text-fg-dim">syncing</span>}
        </span>
      }
      sub={
        <span className="font-mono text-fg-dim">
          block #{Number(lastBlock).toLocaleString()}
        </span>
      }
    />
  );
}
