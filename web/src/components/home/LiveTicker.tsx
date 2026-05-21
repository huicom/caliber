'use client';

import { useLive, useNowTick, formatRelative } from '@/components/live/LiveContext';

/**
 * Caliber-styled block ticker for the sticky header.
 * Renders the latest indexed block + relative timestamp in the
 * design's `.aa-ticker` chrome (paper background, green pulse,
 * mono numerals).
 */
export function LiveTicker() {
  useNowTick(1000);
  const { lastBlock, lastEventAt } = useLive();
  const ago = formatRelative(lastEventAt);

  return (
    <div className="aa-ticker" title="latest indexed block">
      <span className="aa-ticker__dot" aria-hidden="true" />
      <span className="aa-mono">
        {lastBlock ? `#${Number(lastBlock).toLocaleString()}` : 'connecting…'}
      </span>
      {ago ? (
        <>
          <span className="aa-ticker__sep">·</span>
          <span className="aa-mono aa-mute">{ago}</span>
        </>
      ) : null}
    </div>
  );
}
