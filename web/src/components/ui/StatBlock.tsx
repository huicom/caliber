import * as React from 'react';
import { cn } from '@/lib/utils';

interface StatBlockProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  /** When true the value gets a blinking terminal cursor (used for "last event"). */
  live?: boolean;
  /** When true, render a skeleton bar instead of the value. */
  loading?: boolean;
  className?: string;
}

export function StatBlock({
  label,
  value,
  sub,
  live,
  loading,
  className,
}: StatBlockProps) {
  return (
    <div
      className={cn(
        'border border-border rounded-xl bg-bg-elev px-5 py-5',
        'flex flex-col gap-1.5',
        className,
      )}
    >
      <span className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-fg-dim">
        {label}
      </span>
      {loading ? (
        <span
          className="h-7 w-3/4 rounded bg-bg-elev-2 animate-pulse"
          aria-hidden
        />
      ) : (
        <span
          className={cn(
            'font-mono text-2xl md:text-[1.75rem] leading-none text-fg tabular-nums',
            live && 'cursor-blink',
          )}
        >
          {value}
        </span>
      )}
      {sub ? (
        <span className="text-xs text-fg-mute">{sub}</span>
      ) : null}
    </div>
  );
}
