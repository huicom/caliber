'use client';

import { useLive, useNowTick, formatRelative } from '@/components/live/LiveContext';

/**
 * Last-event stat cell for the hero ledger row.
 * Renders the design's `.aa-stat__value--time` treatment with the
 * copper blinking cursor. Reuses the same LiveContext as the header
 * ticker so they stay in sync.
 */
export function LastEventCell() {
  useNowTick(1000);
  const { lastBlock, lastEventAt } = useLive();
  const ago = formatRelative(lastEventAt);

  return (
    <div className="aa-stat">
      <div className="aa-stat__label">last event</div>
      <div className="aa-stat__value aa-stat__value--time">
        {ago ?? 'syncing'}
        <span className="aa-cursor" aria-hidden="true" />
      </div>
      <div className="aa-stat__note">
        block {lastBlock ? `#${Number(lastBlock).toLocaleString()}` : '#—'}
      </div>
    </div>
  );
}
